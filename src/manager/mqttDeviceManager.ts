import env from "@/env";
import logger from "@/logger";
import { buildDevice, buildEntity, buildOrigin } from "@/payload/builder";
import { getTopic, TopicType } from "@/payload/topic";
import initializeMqttClient from "@/service/mqtt";
import { SmartMeterClient } from "@/service/smartMeter";
import { setTimeout } from "timers/promises";

export default async function setupMqttDeviceManager(
  smartMeterClient: SmartMeterClient,
) {
  const {
    device: { deviceId, entities, manufacturer },
  } = smartMeterClient;

  const origin = await buildOrigin();
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
  void (async () => {
    while (true) {
      logger.info("Starting periodic ECHONET property fetch...");
      try {
        const echonetData = await smartMeterClient.fetchData(
          entities.map((entity) => entity.epc),
        );
        logger.debug(`Receive message: ${echonetData.toString()}`);
        echonetData.properties.forEach((property) => {
          const entity = entities.find((entity) => entity.epc === property.epc);
          if (entity === undefined) {
            logger.warn(
              `エンティティに存在しないプロパティ: epc=${property.epc} edt=${property.edt}`,
            );
            return;
          }
          const stateValue = entity.converter(echonetData.getEdt(property.epc));
          mqtt.publish(
            getTopic(deviceId, entity, TopicType.STATE),
            stateValue,
            {
              retain: true,
            },
          );
        });
      } catch (err) {
        logger.error("Failed to fetch ECHONET properties", err);
      }
      await setTimeout(env.ENTITY_UPDATE_INTERVAL);
    }
  })();

  return mqtt;
}
