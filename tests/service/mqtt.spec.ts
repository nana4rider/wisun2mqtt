import env from "@/env";
import logger from "@/logger";
import initializeMqttClient from "@/service/mqtt";
import type { MqttClient, OnErrorCallback } from "mqtt";
import mqttjs from "mqtt";
import { name as packageName } from "package.json";
import { setTimeout } from "timers/promises";

const mockPublishAsync = vi.fn();
const mockEndAsync = vi.fn();
const mockOn = vi.fn();

vi.mock("mqtt", () => ({
  default: {
    connectAsync: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();

  const mockMqttClient: Partial<MqttClient> = {
    publishAsync: mockPublishAsync,
    endAsync: mockEndAsync,
    on: mockOn,
  };
  vi.mocked(mqttjs.connectAsync).mockResolvedValue(
    mockMqttClient as MqttClient,
  );
});

describe("initializeMqttClient", () => {
  test("MQTTクライアントが正常に接続される", async () => {
    const mqtt = await initializeMqttClient();

    await mqtt.close();

    // MQTTクライアントの接続確認
    expect(mqttjs.connectAsync).toHaveBeenCalledExactlyOnceWith(
      env.MQTT_BROKER,
      expect.objectContaining({
        clientId: expect.stringMatching(
          `^${packageName}_[0-9a-z]{8}$`,
        ) as string,
        username: env.MQTT_USERNAME,
        password: env.MQTT_PASSWORD,
      }),
    );
  });

  test("publishがタスクキューに追加される", async () => {
    const mqtt = await initializeMqttClient();

    // publishを呼び出す
    mqtt.publish("topic/publish", "test message", { retain: true });

    // タスクキューの状態を確認
    expect(mqtt.taskQueueSize).toBe(1);

    await mqtt.close(true);
  });

  test("close(true)を呼び出すとタスクキューが空になりクライアントが終了する", async () => {
    mockPublishAsync.mockImplementation(async () => {
      await setTimeout(100);
      return Promise.resolve();
    });

    const mqtt = await initializeMqttClient();

    mqtt.publish("topic", "message");

    // closeを呼び出す
    await mqtt.close(true);

    // タスクキューが空になっていることを確認
    expect(mqtt.taskQueueSize).toBe(0);

    // MQTTクライアントの終了を確認
    expect(mockEndAsync).toHaveBeenCalledTimes(1);
  });

  test("close()を呼び出すとタスクキューが残っていてもクライアントが終了する", async () => {
    mockPublishAsync.mockImplementation(async () => {
      await setTimeout(100);
      return Promise.resolve();
    });

    const mqtt = await initializeMqttClient();

    mqtt.publish("topic", "message");

    // closeを呼び出す
    await mqtt.close();

    // タスクキューが空になっていないことを確認
    expect(mqtt.taskQueueSize).toBe(1);

    // MQTTクライアントの終了を確認
    expect(mockEndAsync).toHaveBeenCalledTimes(1);
  });

  test("接続エラーが発生したとき、エラーログに出力する", async () => {
    const logErrorSpy = vi.spyOn(logger, "error");

    await initializeMqttClient();

    const onErrorCallback = mockOn.mock.calls.find(
      ([event]) => event === "error",
    )?.[1] as OnErrorCallback;
    onErrorCallback(new Error("test error"));

    expect(logErrorSpy).toHaveBeenCalled();
  });
});
