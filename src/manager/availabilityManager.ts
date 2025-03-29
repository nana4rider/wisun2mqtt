import type { Entity } from "@/entity";
import env from "@/env";
import { getTopic, TopicType } from "@/payload/topic";
import type { MqttClient } from "@/service/mqtt";

export function setupAvailability(
  deviceId: string,
  entities: Entity[],
  mqtt: MqttClient,
) {
  const pushAvailability = (value: string) => {
    entities.forEach((entity) =>
      mqtt.publish(getTopic(deviceId, entity, TopicType.AVAILABILITY), value),
    );
  };

  const pushOnline = () => pushAvailability("online");

  // オンライン状態を定期的に送信
  const availabilityTimerId = setInterval(
    pushOnline,
    env.AVAILABILITY_INTERVAL,
  );

  const close = () => {
    clearInterval(availabilityTimerId);
    pushAvailability("offline");
  };

  return {
    pushOnline,
    close,
  };
}
