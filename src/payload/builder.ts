import { Entity } from "@/entity";
import env from "@/env";
import { getTopic, TopicType } from "@/payload/topic";
import type { JsonObject } from "type-fest";
import {
  homepage as packageHomepage,
  name as packageName,
  version as packageVersion,
} from "~/package.json";

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

export function buildDevice(
  deviceId: string,
  manufacturer: string,
): Readonly<Payload> {
  return {
    device: {
      identifiers: [`wisun2mqtt_${deviceId}`],
      name: `低圧スマート電力量メータ`,
      manufacturer,
    },
  };
}

export function buildOrigin(): Readonly<Payload> {
  const origin: Payload = {};
  if (typeof packageName === "string") origin.name = packageName;
  if (typeof packageVersion === "string") origin.sw_version = packageVersion;
  if (typeof packageHomepage === "string") origin.support_url = packageHomepage;
  return { origin };
}
