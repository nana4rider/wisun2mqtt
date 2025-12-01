import env from "@/env";
import logger from "@/logger";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";

type HttpServer = {
  close: () => Promise<void>;
  port: number;
};

export default async function initializeHttpServer(): Promise<HttpServer> {
  const server = createServer();

  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const pathname = req.url?.split("?")[0];
    if (pathname === "/health" && req.method === "GET") {
      const healthResponse = {
        status: "ok",
        uptime: process.uptime(),
        timestamp: Date.now(),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(healthResponse));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once("listening", () => {
      logger.info(`[HTTP] listen port: ${env.PORT}`);
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: promisify(server.close.bind(server)),
      });
    });
    server.once("error", (err) => reject(err));
    server.listen(env.PORT);
  });
}
