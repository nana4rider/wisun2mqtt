import type { Entity } from "@/entity";
import { setupAvailability } from "@/manager/availabilityManager";
import type { MqttClient } from "@/service/mqtt";

describe("setupAvailability", () => {
  const deviceId = "deviceId1";
  const mockMqttClient: MqttClient = {
    publish: vi.fn(),
    taskQueueSize: 0,
    close: vi.fn(),
  };
  const entities = [
    { id: "entity1", name: "Entity 1" },
    { id: "entity2", name: "Entity 2" },
  ] as Entity[];

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("pushOnline を呼び出すと全てのエンティティにオンライン状態を送信する", () => {
    const { pushOnline, close } = setupAvailability(
      deviceId,
      entities,
      mockMqttClient,
    );

    pushOnline();

    expect(mockMqttClient.publish).toHaveBeenCalledTimes(entities.length);
    entities.forEach((entity, index) => {
      expect(mockMqttClient.publish).toHaveBeenNthCalledWith(
        index + 1,
        expect.stringContaining(entity.id),
        "online",
      );
    });

    close();
  });

  it("close を呼び出すと全てのエンティティにオフライン状態を送信する", () => {
    vi.useFakeTimers();
    const { close } = setupAvailability(deviceId, entities, mockMqttClient);

    close();

    expect(mockMqttClient.publish).toHaveBeenCalledTimes(entities.length);
    entities.forEach((entity, index) => {
      expect(mockMqttClient.publish).toHaveBeenNthCalledWith(
        index + 1,
        expect.stringContaining(entity.id),
        "offline",
      );
    });
  });

  it("定期的にオンライン状態を送信する", () => {
    vi.useFakeTimers();
    const { close } = setupAvailability(deviceId, entities, mockMqttClient);

    vi.advanceTimersByTime(10000); // Assume AVAILABILITY_INTERVAL is 10000ms

    expect(mockMqttClient.publish).toHaveBeenCalledTimes(entities.length);
    entities.forEach((entity, index) => {
      expect(mockMqttClient.publish).toHaveBeenNthCalledWith(
        index + 1,
        expect.stringContaining(entity.id),
        "online",
      );
    });

    vi.advanceTimersByTime(10000);

    expect(mockMqttClient.publish).toHaveBeenCalledTimes(entities.length * 2);

    close();
  });
});
