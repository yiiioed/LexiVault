import http from "node:http";
import path from "node:path";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
const root = path.resolve("dist"), port = Number(process.env.PORT || 8e3), host = process.env.HOST || "127.0.0.1";
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".ttf": "font/ttf", ".pdf": "application/pdf" };
const server = http.createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    let info = await stat(file);
    if (info.isDirectory()) {
      file = path.join(file, "index.html");
      info = await stat(file);
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Content-Length": info.size, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("File not available");
  }
});
server.on("error", (e) => {
  console.error(e.code === "EADDRINUSE" ? `端口 ${port} 已占用，可用 PORT=8001 重试。` : e.message);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`LexiVault 已就绪
工作空间：http://${host}:${port}/home.html
研究计划：http://${host}:${port}/plans.html
Ctrl+C 停止。`));
