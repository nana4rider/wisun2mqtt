import env from "@/env";
import { buildDevice, buildEntity, buildOrigin } from "@/payload/builder";
import { getTopic, TopicType } from "@/payload/topic";
import initializeMqttClient from "@/service/mqtt";
import { SmartMeterClient } from "@/service/smartMeter";
import assert from "assert";

export default async function setupMqttDeviceManager(
  smartMeterClient: SmartMeterClient,
) {
  const { deviceId, entities } = smartMeterClient;

  const origin = await buildOrigin();
  const device = buildDevice(deviceId);

  const mqtt = await initializeMqttClient([], () => {});

  // 状態の変更を検知して送信
  smartMeterClient.addListener((entityId: string, value: string) => {
    const entity = entities.find(({ id }) => entityId === id);
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

  return mqtt;
}
