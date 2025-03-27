import env from "@/env";
import logger from "@/logger";
import { randomBytes } from "crypto";
import mqttjs from "mqtt";
import { name as packageName } from "package.json";
import { setTimeout } from "timers/promises";

export type MqttClient = {
  taskQueueSize: number;
  publish: (
    topic: string,
    message: string,
    options?: { retain?: boolean; qos?: 0 | 1 | 2 },
  ) => void;
  close: (wait?: boolean) => Promise<void>;
};

export default async function initializeMqttClient(): Promise<MqttClient> {
  const client = await mqttjs.connectAsync(env.MQTT_BROKER, {
    clientId: `${packageName}_${randomBytes(4).toString("hex")}`,
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD,
  });
  const taskQueue: (() => Promise<void>)[] = [];

  logger.info("[MQTT] connected");

  let isMqttTaskRunning = true;
  const mqttTask = (async () => {
    while (isMqttTaskRunning) {
      logger.silly(`[MQTT] taskQueue: ${taskQueue.length}`);
      const task = taskQueue.shift();
      if (task) {
        await task();
      }
      await setTimeout(env.MQTT_TASK_INTERVAL);
    }
  })();

  const close = async (wait: boolean = false): Promise<void> => {
    if (wait) {
      logger.info("[MQTT] waiting for taskQueue to empty...");
      while (taskQueue.length > 0) {
        await setTimeout(env.MQTT_TASK_INTERVAL);
      }
      logger.info("[MQTT] taskQueue is empty");
    }

    isMqttTaskRunning = false;
    await mqttTask;
    logger.info("[MQTT] task stopped");
    await client.endAsync();
    logger.info("[MQTT] closed");
  };

  const publish = (
    topic: string,
    message: string,
    options?: { retain?: boolean; qos?: 0 | 1 | 2 },
  ): void => {
    taskQueue.push(async () => {
      await client.publishAsync(topic, message, options);
    });
  };

  return {
    get taskQueueSize() {
      return taskQueue.length;
    },
    publish,
    close,
  };
}
