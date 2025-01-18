import { Entity } from "@/entity";
import { setupAvailability } from "@/manager/availabilityManager";
import { MqttClient } from "@/service/mqtt";

describe("setupAvailability", () => {
  const deviceId = "deviceId1";
  let mockMqttClient: jest.Mocked<MqttClient>;
  let entities: Entity[];

  beforeEach(() => {
    mockMqttClient = {
      publish: jest.fn(),
    } as unknown as jest.Mocked<MqttClient>;

    entities = [
      { id: "entity1", name: "Entity 1" },
      { id: "entity2", name: "Entity 2" },
    ] as Entity[];
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it("pushOnline を呼び出すと全てのエンティティにオンライン状態を送信する", () => {
    const { pushOnline, close } = setupAvailability(
      deviceId,
      entities,
      mockMqttClient,
    );

    pushOnline();

    expect(mockMqttClient.publish).toHaveBeenCalledTimes(entities.length);
    entities.forEach((entity) => {
      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        expect.stringContaining(entity.id),
        "online",
      );
    });

    close();
  });

  it("close を呼び出すと全てのエンティティにオフライン状態を送信する", () => {
    jest.useFakeTimers();
    const { close } = setupAvailability(deviceId, entities, mockMqttClient);

    close();

    expect(mockMqttClient.publish).toHaveBeenCalledTimes(entities.length);
    entities.forEach((entity) => {
      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        expect.stringContaining(entity.id),
        "offline",
      );
    });
  });

  it("定期的にオンライン状態を送信する", () => {
    jest.useFakeTimers();
    const { close } = setupAvailability(deviceId, entities, mockMqttClient);

    jest.advanceTimersByTime(10000); // Assume AVAILABILITY_INTERVAL is 10000ms

    expect(mockMqttClient.publish).toHaveBeenCalledTimes(entities.length);
    entities.forEach((entity) => {
      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        expect.stringContaining(entity.id),
        "online",
      );
    });

    jest.advanceTimersByTime(10000);

    expect(mockMqttClient.publish).toHaveBeenCalledTimes(entities.length * 2);

    close();
  });
});
