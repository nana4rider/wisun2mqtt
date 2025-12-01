import env from "@/env";
import logger from "@/logger";
import { buildDevice, buildEntity, buildOrigin } from "@/payload/builder";
import { getTopic, TopicType } from "@/payload/topic";
import initializeMqttClient from "@/service/mqtt";
import type { SmartMeterClient } from "@/service/smartMeter";
import { setTimeout } from "timers/promises";

export default async function setupMqttDeviceManager(
  smartMeterClient: SmartMeterClient,
) {
  const {
    device: { deviceId, entities, manufacturer },
  } = smartMeterClient;

  const origin = buildOrigin();
  const device = buildDevice(deviceId, manufacturer);

  const mqtt = await initializeMqttClient();

  entities.forEach((entity) => {
    // Home Assistantでデバイスを検出
    const discoveryMessage = {
      ...buildEntity(deviceId, entity),
      ...device,
      ...origin,
    };
    mqtt.publish(
      `${env.HA_DISCOVERY_PREFIX}/${entity.domain}/${discoveryMessage.unique_id}/config`,
      JSON.stringify(discoveryMessage),
      { qos: 1, retain: true },
    );
  });

  // 定期的にエンティティの状態を更新
  let isAutoRequestRunning = true;
  const autoRequestTask = (async () => {
    while (isAutoRequestRunning) {
      logger.info("Starting periodic ECHONET property fetch...");
      try {
        const epcs = [...new Set(entities.map((e) => e.epc))];
        const echonetData = await smartMeterClient.fetchData(epcs);
        logger.debug(`Receive message: ${echonetData.toString()}`);
        echonetData.properties.forEach((property) => {
          const targetEntities = entities.filter(
            (entity) => entity.epc === property.epc,
          );
          if (targetEntities.length === 0) {
            logger.error(
              `エンティティに存在しないプロパティ: epc=${property.epc} edt=${property.edt}`,
            );
            return;
          }
          for (const entity of targetEntities) {
            const stateValue = entity.converter(
              echonetData.getEdt(property.epc),
            );
            mqtt.publish(
              getTopic(deviceId, entity, TopicType.STATE),
              stateValue,
              {
                retain: true,
              },
            );
          }
        });

        logger.info("ECHONET property fetch completed successfully.");
      } catch (err) {
        logger.error("Failed to fetch ECHONET properties", err);
      }
      await setTimeout(env.AUTO_REQUEST_INTERVAL);
    }
  })();

  const stopAutoRequest = async () => {
    isAutoRequestRunning = false;
    await autoRequestTask;
  };

  return { mqtt, stopAutoRequest };
}
