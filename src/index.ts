import { EchonetLite } from "@/connector/EchonetLite";
import { PanDescription, WiSunConnector } from "@/connector/WiSunConnector";
import env from "@/env";
import logger from "@/logger";
import { setTimeout } from "timers/promises";

async function main() {
  logger.info("start");

  const wiSunConnector = new WiSunConnector(env.WISUN_DEVICE);
  const echonetLite = new EchonetLite();

  logger.info("Initializing WiSunConnector and EchonetLite...");
  await Promise.all([
    async () => {
      const version = await wiSunConnector.getVersion();
      logger.info(`version: ${version}`);
      await wiSunConnector.setAuth(env.ROUTE_B_ID, env.ROUTE_B_PASSWORD);
      let description: PanDescription | undefined = undefined;
      while ((description = await wiSunConnector.executeScan()) === undefined) {
        logger.warn("スキャン結果なし");
        await setTimeout(1000);
      }
      logger.info(`スキャン結果あり: ${JSON.stringify(description)}`);
      await wiSunConnector.connect(description);
    },
    echonetLite.connect(),
  ]);

  // スマートメーターからの受信をUDPマルチキャストへ送信
  wiSunConnector.on("message", (message: string) => {
    void echonetLite.sendMulticast(message);
  });

  // UDPからの受信をスマートメーターへ送信
  echonetLite.on("message", (message: string) => {
    void wiSunConnector.sendEchonetData(message);
  });

  const handleError = (context: string) => (err: Error) => {
    logger.error(`[${context}] error:`, err);
  };

  wiSunConnector.on("error", handleError("Route B Connector"));
  echonetLite.on("error", handleError("UDP Multicast"));

  const handleShutdown = async () => {
    logger.info("shutdown");
    await wiSunConnector.close();
    await echonetLite.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  logger.info("ready");
}

try {
  await main();
} catch (err) {
  logger.error("main() error:", err);
  process.exit(1);
}
