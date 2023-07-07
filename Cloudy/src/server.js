const express = require("express")
const fs = require("fs")
const nunjucks = require("nunjucks")
const expressWs = require("express-ws")
const session = require("express-session")
const https = require("https")
const cors = require("cors")

const userSession = session({
  name: "session",
  secret: "secrets",
  resave: true,
  saveUninitialized: true,
})

// Set up MongoDB
const mongodb = require("mongodb")
const { MONGODB } = require("./keys/credentials")
const uri = `mongodb+srv://${MONGODB.user}:${MONGODB.password}@${MONGODB.cluster}/?retryWrites=true&w=majority`
const client = new mongodb.MongoClient(uri)
const default_database = "Cloudy"

const port = 3000
const app = express()
app.use(cors())
const wsInstance = expressWs(app)

nunjucks.configure("../views", {
  autoescape: true,
  express: app,
  noCache: true,
})

client.connect().then(console.log)

app.use(userSession)

/*
  Session-based function.  If a user is logged in, do nothing.
  If there is no user logged in, redirect to login page.
*/
function restrict(req, res, next) {
  if (req.session.user) {
    next()
  } else {
    req.session.error = "Access Denied"
    res.redirect("/")
  }
}

// Using route string parameter
const user_routes = require("./controller/routes/loginRoutes")
app.use("/", user_routes(client))

const upload_route = require("./controller/routes/upload")
app.use("/upload", restrict, upload_route(client))
app.use("/delete", restrict, upload_route(client))

app.ws("/gallery", async (ws, req) => {
  //Connect to a WebSocket Server
  console.log("Web Socket Opened")
  const aWS = wsInstance.getWss("/gallery")
  const database = req.session.user

  //Watch the files collection for any changes
  const my_col = client.db(database).collection("fs.files")
  const changeStream = my_col.watch()

  changeStream.on("change", (changeEvent) => {
    //On insertion, add the new element to the list.
    console.log(changeEvent)
    aWS.clients.forEach(function (client) {
      if (changeEvent.operationType === "insert") {
        client.send(
          JSON.stringify({
            event: changeEvent.operationType,
            payload: changeEvent.fullDocument.filename,
          })
        )
      }
      //On deletion, inform the user that a file has changed.
      else if (changeEvent.operationType === "delete") {
        client.send(
          JSON.stringify({
            event: "removal",
            payload: "A file has been modified!  Please refresh",
          })
        )
      }
    })
  })
})

const root_middleware = require("./controller/routes/root_middleware")
const { log } = require("console")
app.use("/files", restrict, root_middleware(client, { cacheSize: 25000000 }))

let certificates = {
  key: fs.readFileSync("keys/key.pem"),
  cert: fs.readFileSync("keys/cert.pem"),
}

https.createServer(certificates, app).listen(port, () => {
  console.log(`Listening on port ${port}`)
})
