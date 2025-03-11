import env from "@/env";
import initializeMqttClient from "@/service/mqtt";
import mqttjs, { MqttClient } from "mqtt";
import { setTimeout } from "timers/promises";

// 必要なモック関数
const mockSubscribeAsync = jest.fn();
const mockPublishAsync = jest.fn();
const mockEndAsync = jest.fn();
const mockOn = jest.fn<
  ReturnType<MqttClient["on"]>,
  Parameters<MqttClient["on"]>
>();

jest.mock("mqtt", () => {
  return {
    connectAsync: jest.fn(),
  };
});

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe("initializeMqttClient", () => {
  test("MQTTクライアントが正常に接続される", async () => {
    const mockConnectAsync = mqttjs.connectAsync as jest.Mock;
    mockConnectAsync.mockResolvedValue({
      subscribeAsync: mockSubscribeAsync,
      publishAsync: mockPublishAsync,
      endAsync: mockEndAsync,
      on: mockOn,
    });

    const mqtt = await initializeMqttClient();

    await mqtt.close();

    // MQTTクライアントの接続確認
    expect(mockConnectAsync).toHaveBeenCalledWith(
      env.MQTT_BROKER,
      expect.objectContaining({
        username: env.MQTT_USERNAME,
        password: env.MQTT_PASSWORD,
      }),
    );
  });

  test("publishがタスクキューに追加される", async () => {
    const mockConnectAsync = mqttjs.connectAsync as jest.Mock;
    mockConnectAsync.mockResolvedValue({
      subscribeAsync: mockSubscribeAsync,
      publishAsync: mockPublishAsync,
      endAsync: mockEndAsync,
      on: mockOn,
    });

    const mqtt = await initializeMqttClient();

    // publishを呼び出す
    mqtt.publish("topic/publish", "test message", { retain: true });

    // タスクキューの状態を確認
    expect(mqtt.taskQueueSize).toBe(1);

    await mqtt.close(true);
  });

  test("close(true)を呼び出すとタスクキューが空になりクライアントが終了する", async () => {
    const mockConnectAsync = mqttjs.connectAsync as jest.Mock;
    mockConnectAsync.mockResolvedValue({
      subscribeAsync: mockSubscribeAsync,
      publishAsync: mockPublishAsync,
      endAsync: mockEndAsync,
      on: mockOn,
    });
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
    const mockConnectAsync = mqttjs.connectAsync as jest.Mock;
    mockConnectAsync.mockResolvedValue({
      subscribeAsync: mockSubscribeAsync,
      publishAsync: mockPublishAsync,
      endAsync: mockEndAsync,
      on: mockOn,
    });
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
});
