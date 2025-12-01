import type { Entity } from "@/entity";
import { buildDevice, buildEntity, buildOrigin } from "@/payload/builder";
import { TopicType } from "@/payload/topic";

describe("buildEntity", () => {
  test("必要な属性が揃っている", () => {
    const mockEntity = {
      id: "entity1",
      name: "Test Entity",
      deviceClass: "energy",
      stateClass: "total_increasing",
      unit: "kWh",
      nativeValue: "float",
      unitPrecision: 3,
    } as Entity;

    const entity = buildEntity("deviceId1", mockEntity);

    expect(entity).toHaveProperty("unique_id", "wisun2mqtt_deviceId1_entity1");
    expect(entity).toHaveProperty("name", "Test Entity");
    expect(entity).toHaveProperty(
      "state_topic",
      `wisun2mqtt/deviceId1/entity1/${TopicType.STATE}`,
    );
    expect(entity).toHaveProperty(
      "availability_topic",
      `wisun2mqtt/deviceId1/entity1/${TopicType.AVAILABILITY}`,
    );
    expect(entity).toHaveProperty("device_class", "energy");
    expect(entity).toHaveProperty("state_class", "total_increasing");
    expect(entity).toHaveProperty("unit_of_measurement", "kWh");
    expect(entity).toHaveProperty("native_value", "float");
    expect(entity).toHaveProperty("suggested_display_precision", 3);
    expect(entity).toHaveProperty("qos");
  });

  test("非必須属性が未設定の場合は含めない", () => {
    const mockEntity = {
      id: "entity1",
      name: "Test Entity",
    } as Entity;

    const entity = buildEntity("deviceId1", mockEntity);

    expect(entity).not.toHaveProperty("device_class");
    expect(entity).not.toHaveProperty("state_class");
    expect(entity).not.toHaveProperty("unit_of_measurement");
    expect(entity).not.toHaveProperty("native_value");
    expect(entity).not.toHaveProperty("suggested_display_precision");
  });
});

describe("buildDevice", () => {
  test("必要な属性が揃っている", () => {
    const device = buildDevice("deviceId1", "manufacturer");
    expect(device).toHaveProperty("device.identifiers");
    expect(device).toHaveProperty("device.name");
    expect(device).toHaveProperty("device.manufacturer");
  });
});

describe("buildOrigin", () => {
  test("必要な属性が揃っている", () => {
    const origin = buildOrigin();
    expect(origin).toHaveProperty("origin.name");
    expect(origin).toHaveProperty("origin.sw_version");
    expect(origin).toHaveProperty("origin.support_url");
  });
});
