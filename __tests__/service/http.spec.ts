import env from "@/env";
import initializeHttpServer from "@/service/http";
import { FastifyInstance } from "fastify";
import { MutableEnv } from "jest.setup";

describe("initializeHttpServer", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    (env as MutableEnv).PORT = undefined;
    jest.clearAllMocks();
    server = await initializeHttpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  test("/health エンドポイントでヘルスステータスが返されること", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      uptime: expect.any(Number) as number,
      timestamp: expect.any(Number) as number,
    });
  });
});
