// lib/http.js — tiny helpers shared by every /api handler so the same code
// works unmodified on Vercel (which auto-parses JSON into req.body) and on
// the local zero-dependency dev server (server.js), which populates
// req.body itself before calling the handler.

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  if (req.body !== undefined) {
    // Already parsed (Vercel Node runtime, or our local server did it).
    return req.body || {};
  }
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

module.exports = { sendJson, readJsonBody };
