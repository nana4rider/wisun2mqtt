import env from "@/env";
import logger from "@/logger";
import { buildDevice, buildEntity, buildOrigin } from "@/payload/builder";
import { getTopic, TopicType } from "@/payload/topic";
import initializeMqttClient from "@/service/mqtt";
import { SmartMeterClient } from "@/service/smartMeter";
import assert from "assert";
import { setTimeout } from "timers/promises";

export default async function setupMqttDeviceManager(
  smartMeterClient: SmartMeterClient,
) {
  const { deviceId, entities } = smartMeterClient;

  const origin = await buildOrigin();
  const device = buildDevice(deviceId);

  const mqtt = await initializeMqttClient();

  // 状態の変更を検知して送信
  smartMeterClient.addListener((entityId: string, value: string) => {
    const entity = entities.find((entity) => entity.id === entityId);
    assert(entity !== undefined);
    mqtt.publish(getTopic(deviceId, entity, TopicType.STATE), value, {
      retain: true,
    });
  });

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

  // 定期的にリクエスト要求
  void (async () => {
    while (true) {
      logger.info("Starting periodic ECHONET property fetch...");
      try {
        await smartMeterClient.request();
      } catch (err) {
        logger.error("Failed to fetch ECHONET properties", err);
      }
      await setTimeout(env.ENTITY_UPDATE_INTERVAL);
    }
  })();

  return mqtt;
}
