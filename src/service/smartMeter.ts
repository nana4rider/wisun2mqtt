import { WiSunConnector } from "@/connector/WiSunConnector";
import { Entity } from "@/entity";
import env from "@/env";

export type SmartMeterClient = {
  deviceId: string;
  entities: Entity[];
  addListener: (listen: (entityId: string, value: string) => void) => void;
  close: () => Promise<void>;
};

export default async function initializeSmartMeterClient(): Promise<SmartMeterClient> {
  const wiSunConnector = new WiSunConnector(
    env.WISUN_DEVICE,
    env.WISUN_COMMAND_TIMEOUT,
  );
  await wiSunConnector.reset();
  await wiSunConnector.setAuth(env.ROUTE_B_ID, env.ROUTE_B_PASSWORD);
  await wiSunConnector.scanAndJoin(env.WISUN_SCAN_RETRIES);

  // TODO 定期的にリクエスト要求
  // await wiSunConnector.sendEchonetData('xxx')

  // const getDeviceId = async () => {
  //   const response = await wiSunConnector.sendCommand("udp");
  //   // TODO parser
  //   return "foo";
  // };
  const deviceId = ""; // TODO 何かで求める

  const entities: Entity[] = []; // TODO 電力単位もプロパティから取る

  const addListener = (
    listener: (propertyName: string, value: string) => void,
  ) => {
    wiSunConnector.on("message", (message: string) => {
      // TODO echonet messageを解析して通知する
      listener("entityId", message);
    });
  };

  return {
    deviceId,
    entities,
    addListener,
    close: () => wiSunConnector.close(),
  };
}
