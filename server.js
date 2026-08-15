// server.js — zero-dependency local dev server.
//
// Serves public/ as static files and dispatches /api/* requests to the same
// handler modules Vercel will use in production (api/**.js, each exporting
// `module.exports = async (req, res) => {...}`). No npm install required to
// run this locally: `node server.js`.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { readJsonBody } = require("./lib/http.js");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const API_DIR = path.join(__dirname, "api");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

function serveStatic(req, res) {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  if (reqPath === "/") reqPath = "/index.html";
  const filePath = path.join(PUBLIC_DIR, reqPath);

  // Prevent path traversal outside public/
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.end(data);
  });
}

async function dispatchApi(req, res, apiPath) {
  // apiPath e.g. "long-weekends" or "cron/weekly-check"
  const modulePath = path.join(API_DIR, `${apiPath}.js`);
  if (!modulePath.startsWith(API_DIR) || !fs.existsSync(modulePath)) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "No such API route" }));
  }

  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    try {
      req.body = await readJsonBody(req);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Invalid JSON body" }));
    }
  }

  delete require.cache[require.resolve(modulePath)]; // pick up edits during dev
  const handler = require(modulePath);
  return handler(req, res);
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split("?")[0];
  try {
    if (urlPath.startsWith("/api/")) {
      const apiPath = urlPath.replace(/^\/api\//, "").replace(/\/$/, "");
      await dispatchApi(req, res, apiPath);
    } else {
      serveStatic(req, res);
    }
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

server.listen(PORT, () => {
  console.log(`Trip Planner running at http://localhost:${PORT}`);
});
