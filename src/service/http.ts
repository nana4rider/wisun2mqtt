import env from "@/env";
import logger from "@/logger";
import fastify from "fastify";

export default async function initializeHttpServer() {
  const server = fastify();

  server.get("/health", () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  }));

  await server.listen({ host: "0.0.0.0", port: env.PORT });
  logger.info(`[HTTP] listen port: ${env.PORT}`);

  return server;
}
