import logger from "@/logger";
import { setupAvailability } from "@/manager/availabilityManager";
import setupMqttDeviceManager from "@/manager/mqttDeviceManager";
import initializeHttpServer from "@/service/http";
import initializeSmartMeterClient from "@/service/smartMeter";

async function main() {
  logger.info("start");

  const smartMeterClient = await initializeSmartMeterClient();
  const mqtt = await setupMqttDeviceManager(smartMeterClient);
  const http = await initializeHttpServer();
  const {
    device: { deviceId, entities },
  } = smartMeterClient;
  const availability = setupAvailability(deviceId, entities, mqtt);

  const handleShutdown = async () => {
    logger.info("shutdown");
    availability.close();
    await mqtt.close(true);
    await http.close();
    await smartMeterClient.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown());
  process.on("SIGTERM", () => void handleShutdown());

  availability.pushOnline();

  logger.info("ready");
}

try {
  await main();
} catch (err) {
  logger.error("main() error:", err);
  process.exit(1);
}
