import { EchonetData } from "@/echonet/EchonetData";
import { Entity } from "@/entity";
import env from "@/env";
import logger from "@/logger";
import setupMqttDeviceManager from "@/manager/mqttDeviceManager";
import { buildDevice, buildEntity, buildOrigin } from "@/payload/builder";
import initializeMqttClient, { MqttClient } from "@/service/mqtt";
import { SmartMeterClient } from "@/service/smartMeter";
import { Mock } from "vitest";

vi.mock("@/payload/builder", () => ({
  buildEntity: vi.fn(),
  buildDevice: vi.fn(),
  buildOrigin: vi.fn(),
}));

vi.mock("@/service/mqtt", () => ({
  default: vi.fn(),
}));

describe("setupMqttDeviceManager", () => {
  let mockMqttClient: MqttClient;

  beforeEach(() => {
    vi.resetAllMocks();

    mockMqttClient = {
      publish: vi.fn(),
      taskQueueSize: 0,
      close: vi.fn(),
    };

    (initializeMqttClient as Mock).mockResolvedValue(mockMqttClient);
    (buildOrigin as Mock).mockReturnValue({ origin: "test-origin" });
    (buildDevice as Mock).mockReturnValue({ device: "test-device" });
    (buildEntity as Mock).mockImplementation(
      (deviceId: string, entity: Entity) => ({
        unique_id: `wisun2mqtt_${deviceId}_${entity.id}`,
        name: entity.name,
      }),
    );
  });

  test("Home Assistantにデバイス情報が送信される", async () => {
    const mockFetchData = vi.fn();
    const smartMeterClient = {
      device: {
        deviceId: "deviceId",
        manufacturer: "manufacturer",
        entities: [
          {
            id: "entity1",
            name: "name1",
            domain: "sensor",
          },
        ],
      },
      fetchData: mockFetchData,
    } as unknown as SmartMeterClient;
    mockFetchData.mockResolvedValue([]);

    const { stopAutoRequest } = await setupMqttDeviceManager(smartMeterClient);
    await stopAutoRequest();

    expect(mockMqttClient.publish).toHaveBeenCalledWith(
      `${env.HA_DISCOVERY_PREFIX}/sensor/wisun2mqtt_deviceId_entity1/config`,
      JSON.stringify({
        unique_id: "wisun2mqtt_deviceId_entity1",
        name: "name1",
        device: "test-device",
        origin: "test-origin",
      }),
      { qos: 1, retain: true },
    );
  });

  test("定期的な自動取得が呼び出される", async () => {
    const mockFetchData = vi.fn();
    const smartMeterClient = {
      device: {
        deviceId: "deviceId",
        manufacturer: "manufacturer",
        entities: [
          {
            id: "entity1",
            name: "name1",
            domain: "sensor",
            epc: 0x88,
          },
          {
            id: "entity2",
            name: "name2",
            domain: "sensor",
            epc: 0x99,
          },
        ] as Entity[],
      },
      fetchData: mockFetchData,
    } as unknown as SmartMeterClient;
    mockFetchData.mockResolvedValue(
      EchonetData.create({
        seoj: 0x05ff01,
        deoj: 0x028801,
        esv: 0x62,
        tid: 0x99,
        properties: [],
      }),
    );

    const { stopAutoRequest } = await setupMqttDeviceManager(smartMeterClient);
    await stopAutoRequest();

    expect(mockFetchData).toHaveBeenCalledWith([0x88, 0x99]);
  });

  test("エンティティに存在しないepcは無視する", async () => {
    const mockFetchData = vi.fn();
    const mockConverter = vi.fn();

    const smartMeterClient = {
      device: {
        deviceId: "deviceId",
        manufacturer: "manufacturer",
        entities: [
          {
            id: "entity1",
            name: "name1",
            domain: "sensor",
            epc: 0x88,
            converter: mockConverter,
          },
        ] as unknown as Entity[],
      },
      fetchData: mockFetchData,
    } as unknown as SmartMeterClient;
    mockFetchData.mockResolvedValue(
      EchonetData.create({
        seoj: 0x05ff01,
        deoj: 0x028801,
        esv: 0x62,
        tid: 0x99,
        properties: [{ epc: 0xff }],
      }),
    );

    const { stopAutoRequest } = await setupMqttDeviceManager(smartMeterClient);
    await stopAutoRequest();

    expect(mockConverter).not.toHaveBeenCalled();
  });

  test("エンティティに存在するepcは更新する", async () => {
    const mockFetchData = vi.fn();
    const mockConverter = vi.fn().mockReturnValue("999");

    const smartMeterClient = {
      device: {
        deviceId: "deviceId",
        manufacturer: "manufacturer",
        entities: [
          {
            id: "entity1",
            name: "name1",
            domain: "sensor",
            epc: 0x88,
            converter: mockConverter,
          },
        ] as unknown as Entity[],
      },
      fetchData: mockFetchData,
    } as unknown as SmartMeterClient;
    mockFetchData.mockResolvedValue(
      EchonetData.create({
        seoj: 0x05ff01,
        deoj: 0x028801,
        esv: 0x62,
        tid: 0x99,
        properties: [{ epc: 0x88 }],
      }),
    );

    const { stopAutoRequest } = await setupMqttDeviceManager(smartMeterClient);
    await stopAutoRequest();

    expect(mockConverter).toHaveBeenCalled();
    expect(mockMqttClient.publish).toHaveBeenCalledWith(
      "wisun2mqtt/deviceId/entity1/state",
      "999",
      {
        retain: true,
      },
    );
  });

  test("自動リクエスト中にエラーが発生した場合ログに記録される", async () => {
    const mockFetchData = vi.fn();
    const mockConverter = vi.fn().mockReturnValue("999");

    const smartMeterClient = {
      device: {
        deviceId: "deviceId",
        manufacturer: "manufacturer",
        entities: [
          {
            id: "entity1",
            name: "name1",
            domain: "sensor",
            epc: 0x88,
            converter: mockConverter,
          },
        ] as unknown as Entity[],
      },
      fetchData: mockFetchData,
    } as unknown as SmartMeterClient;
    mockFetchData.mockRejectedValue(new Error("test error"));

    const logErrorSpy = vi.spyOn(logger, "warn");
    const { stopAutoRequest } = await setupMqttDeviceManager(smartMeterClient);
    await stopAutoRequest();

    expect(logErrorSpy).toHaveBeenCalledWith(
      "Failed to fetch ECHONET properties",
      expect.any(Error),
    );
  });
});
