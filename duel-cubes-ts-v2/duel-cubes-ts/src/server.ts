import * as http from "http";
import { config } from "./config.js";

export function startHttpServer(): void {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Duel Cubes Bot is Live! 🎲");
  });
  server.listen(config.PORT, () =>
    console.log(`[HTTP] Keep-alive server on port ${config.PORT}`)
  );
  server.on("error", (err) => console.error("[HTTP] Error:", err));
}
