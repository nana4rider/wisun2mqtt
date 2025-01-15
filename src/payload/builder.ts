import { Entity } from "@/entity";
import env from "@/env";
import { getTopic, TopicType } from "@/payload/topic";
import { readFile } from "fs/promises";
import type { JsonObject, PackageJson } from "type-fest";

export type Payload = JsonObject;

export function buildEntity(
  deviceId: string,
  entity: Entity,
): Readonly<Payload & { unique_id: string }> {
  const baseMessage = {
    unique_id: `wisun2mqtt_${deviceId}_${entity.id}`,
    name: entity.name,
    state_topic: getTopic(deviceId, entity, TopicType.STATE),
    availability_topic: getTopic(deviceId, entity, TopicType.AVAILABILITY),
    qos: env.ENTITY_QOS,
  };

  const optionMessage: Payload = {};
  if (entity.deviceClass) {
    optionMessage.device_class = entity.deviceClass;
  }
  if (entity.stateClass) {
    optionMessage.state_class = entity.stateClass;
  }
  if (entity.unit) {
    optionMessage.unit_of_measurement = entity.unit;
  }
  if (entity.nativeValue) {
    optionMessage.native_value = entity.nativeValue;
  }
  if (entity.unitPrecision) {
    optionMessage.suggested_display_precision = entity.unitPrecision;
  }

  return { ...baseMessage, ...optionMessage } as const;
}

export function buildDevice(deviceId: string): Readonly<Payload> {
  return {
    device: {
      identifiers: [`wisun2mqtt_${deviceId}`],
      name: `wisun2mqtt.${deviceId}`,
      model: "wisun2mqtt",
      manufacturer: "nana4rider",
    },
  };
}

export async function buildOrigin(): Promise<Readonly<Payload>> {
  const { homepage, name, version } = JSON.parse(
    await readFile("package.json", "utf-8"),
  ) as PackageJson;
  const origin: Payload = {};
  if (typeof name === "string") origin.name = name;
  if (typeof version === "string") origin.sw_version = version;
  if (typeof homepage === "string") origin.support_url = homepage;
  return { origin };
}
