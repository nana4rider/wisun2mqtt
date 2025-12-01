import env from "@/env";
import initializeHttpServer from "@/service/http";
import type { Writable } from "type-fest";

const writableEnv: Writable<typeof env> = env;

describe("initializeHttpServer", () => {
  let server: Awaited<ReturnType<typeof initializeHttpServer>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    writableEnv.PORT = 0;
    server = await initializeHttpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  test("/health エンドポイントでヘルスステータスが返されること", async () => {
    const response = await fetch(`http://localhost:${server.port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      uptime: expect.any(Number) as number,
      timestamp: expect.any(Number) as number,
    });
  });

  test("その他のパスは404を返すこと", async () => {
    const response = await fetch(`http://localhost:${server.port}/foo`, {
      method: "POST",
    });

    expect(response.status).toBe(404);
  });

  test("サーバーの立ち上げに失敗した場合は例外をスローすること", async () => {
    // 同じポートで2つ目のHTTPサーバーを立ち上げる
    writableEnv.PORT = server.port;

    await expect(initializeHttpServer()).rejects.toThrowError();
  });
});
