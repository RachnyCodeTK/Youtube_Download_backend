const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const downloadRoute = require("./routes/downloadRoute");

const app = express();

app.use(cors());
app.use(express.json());

const downloadPath = path.join(__dirname, "downloads");

if (!fs.existsSync(downloadPath)) {
  fs.mkdirSync(downloadPath);
}

app.use("/api", downloadRoute);

const PORT = 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Disable default Node request timeout for long-running download generation
server.timeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;