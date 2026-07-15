import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { handleApi, initApi, getStorageLabel } from "./api-handler.js";

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = join(process.cwd(), "public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function servePublic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(PUBLIC_DIR, pathname);
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    const data = await readFile(join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(data);
  }
}

await initApi();

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    await servePublic(req, res);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "Erreur serveur." });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Agent Pilot Avis lancé sur http://127.0.0.1:${PORT}`);
  console.log(`Stockage: ${getStorageLabel()}`);
  console.log(`Admin: ${process.env.ADMIN_EMAIL || "admin@agentpilotavis.local"} / ${process.env.ADMIN_PASSWORD || "admin123"}`);
  console.log("Client demo: client@demo.fr / demo123");
});
