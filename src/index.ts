import { EchonetConnector } from "@/connector/EchonetConnector";
import { PanDescription, WiSunConnector } from "@/connector/WiSunConnector";
import env from "@/env";
import logger from "@/logger";
import { setTimeout } from "timers/promises";

async function main() {
  logger.info("Application started");

  const wiSunConnector = new WiSunConnector(
    env.WISUN_DEVICE,
    env.WISUN_COMMAND_TIMEOUT,
  );
  const echonetConnector = new EchonetConnector();

  logger.info("Initializing Wi-SUN and Echonet connectors...");
  await Promise.all([
    (async () => {
      logger.info("Resetting Wi-SUN module");
      await wiSunConnector.reset();

      logger.info("Setting authentication credentials");
      await wiSunConnector.setAuth(env.ROUTE_B_ID, env.ROUTE_B_PASSWORD);

      logger.info("Scanning for smart meters");
      const maxRetries = env.WISUN_SCAN_RETRIES;
      let retries = 0;
      let description: PanDescription | undefined = undefined;
      while ((description = await wiSunConnector.executeScan()) === undefined) {
        retries++;
        if (retries >= maxRetries) {
          logger.error(`Scan failed after ${maxRetries} retries`);
          throw new Error("Wi-SUN scan failed");
        }

        // スキャン失敗時のリトライ処理
        logger.warn(
          `Scan attempt ${retries}/${maxRetries} failed. Retrying...`,
        );
        await setTimeout(1000); // 1秒待機
      }

      logger.info("Connecting to the smart meter");
      await wiSunConnector.connect(description);
    })(),
    echonetConnector.connect(),
  ]);

  // スマートメーターからの受信をUDPマルチキャストへ送信
  wiSunConnector.on("message", (message: string) => {
    logger.info(`Message received from Wi-SUN: ${message}`);
    void echonetConnector.sendMulticast(message);
  });

  // UDPからの受信をスマートメーターへ送信
  echonetConnector.on("message", (message: string) => {
    logger.info(`Message received from Echonet multicast: ${message}`);
    void wiSunConnector.sendEchonetData(message);
  });

  // エラーハンドリング
  const handleError = (context: string) => (err: Error) => {
    logger.error(`[${context}] encountered an error:`, err);
  };

  wiSunConnector.on("error", handleError("Wi-SUN Connector"));
  echonetConnector.on("error", handleError("Echonet Connector"));

  // シャットダウン処理
  const handleShutdown = async () => {
    logger.info("Shutting down application");
    await wiSunConnector.close();
    await echonetConnector.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  logger.info("Initialization complete. Application is ready");
}

try {
  await main();
} catch (err) {
  logger.error("main() error:", err);
  process.exit(1);
}
