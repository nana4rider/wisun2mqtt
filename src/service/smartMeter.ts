import { WiSunConnector } from "@/connector/WiSunConnector";
import { Entity } from "@/entity";
import env from "@/env";
import logger from "@/logger";
import { getDecimalPlaces } from "@/util/dataTransformUtil";
import {
  convertUnitForCumulativeElectricEnergy,
  createEchonetMessage,
  EchonetData,
  parseEchonetMessage,
} from "@/util/echonetUtil";
import { setTimeout } from "timers/promises";

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
  wiSunConnector.on("error", (err) =>
    logger.error("Wi-SUN Connector Error:", err),
  );

  const baseRequestData = {
    seoj: "028801", // スマートメーター
    deoj: "05FF01", // コントローラー
    esv: "62", // GET命令
    tid: "0001",
  };

  const getEchonet = async <T extends string>(properties: {
    [epc in T]: string;
  }): Promise<EchonetData<T>> => {
    const requestMessage = createEchonetMessage<T>({
      ...baseRequestData,
      properties,
    });

    const responseData = await wiSunConnector.sendEchonet(requestMessage);
    return parseEchonetMessage(responseData);
  };

  // エンティティの必要なプロパティを要求
  const initialData = await getEchonet({
    "0x8A": "", // メーカーコード
    "0x8D": "", // 製造番号
    "0xE1": "", // 積算電力量単位 (正方向、逆方向計測値)
    "0xD3": "", // 係数
  });
  const cumulativeMultiplier = convertUnitForCumulativeElectricEnergy(
    initialData.properties["0xE1"],
  );
  const cumulativeCoefficient = parseInt(initialData.properties["0xD3"], 16);
  const cumulativeUnitPrecision = getDecimalPlaces(cumulativeMultiplier);

  const manufacturer = initialData.properties["0x8A"];
  const serialNumber = initialData.properties["0x8D"];
  const deviceId = `${manufacturer}_${serialNumber}`;
  const entities: Entity[] = [];

  // Home Assistantに登録するエンティティ
  entities.push({
    id: "operationStatus",
    name: "動作状態",
    domain: "binary_sensor",
    deviceClass: "running",
    epc: "0x80",
    converter: (value) => String(value === "0x30"),
  });
  entities.push({
    id: "faultStatus",
    name: "異常発生状態",
    domain: "binary_sensor",
    deviceClass: "problem",
    epc: "0x88",
    converter: (value) => String(value === "0x41"),
  });
  entities.push({
    id: "instantaneousElectricPower",
    name: "瞬時電力計測値",
    domain: "sensor",
    deviceClass: "power",
    stateClass: "measurement",
    unit: "W",
    unitType: "measurement",
    epc: "0xE7",
    converter: (value) => String(parseInt(value, 16)),
  });
  entities.push({
    id: "instantaneousCurrent",
    name: "瞬時電流計測値",
    domain: "sensor",
    deviceClass: "current",
    stateClass: "total_increasing",
    unit: "A",
    unitType: "measurement",
    unitPrecision: 1,
    epc: "0xE8",
    converter: (value) => String(parseInt(value, 16) * 0.1),
  });
  entities.push({
    id: "normalDirectionCumulativeElectricEnergy",
    name: "積算電力量計測値 (正方向計測値)",
    domain: "sensor",
    deviceClass: "energy",
    stateClass: "total_increasing",
    unit: "kWh",
    unitType: "total_increasing",
    unitPrecision: cumulativeUnitPrecision,
    epc: "0xE0",
    converter: (value) =>
      String(
        parseInt(value, 16) * cumulativeMultiplier * cumulativeCoefficient,
      ),
  });
  entities.push({
    id: "reverseDirectionCumulativeElectricEnergy",
    name: "積算電力量計測値 (逆方向計測値)",
    domain: "sensor",
    deviceClass: "energy",
    unit: "kWh",
    unitType: "total_increasing",
    unitPrecision: cumulativeUnitPrecision,
    epc: "0xE3",
    converter: (value) =>
      String(
        parseInt(value, 16) * cumulativeMultiplier * cumulativeCoefficient,
      ),
  });

  // エンティティの更新を通知するリスナー
  const addListener = (listener: (entityId: string, value: string) => void) => {
    wiSunConnector.on("message", (message: string) => {
      const { properties } = parseEchonetMessage(message);
      Object.entries(properties).forEach(([epc, edt]) => {
        const entity = entities.find((entity) => entity.epc === epc);
        if (!entity) {
          return;
        }
        listener(entity.id, entity.converter(edt));
      });
    });
  };

  // 定期的にリクエスト要求
  void (async () => {
    while (true) {
      logger.info("Starting periodic ECHONET property fetch...");
      try {
        await getEchonet({
          "0x80": "", // 動作状態
          "0x88": "", // 異常発生状態
          "0xE7": "", // 瞬時電力計測値
          "0xE8": "", // 瞬時電流計測値
          "0xE0": "", // 積算電力量計測値 (正方向計測値)
          "0xE3": "", // 積算電力量計測値 (逆方向計測値)
        });
      } catch (err) {
        logger.error("Failed to fetch ECHONET properties", err);
      }
      await setTimeout(env.ENTITY_UPDATE_INTERVAL);
    }
  });

  return {
    deviceId,
    entities,
    addListener,
    close: () => wiSunConnector.close(),
  };
}
