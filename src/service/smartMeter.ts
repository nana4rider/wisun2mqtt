import createWiSunConnector from "@/connector/WiSunConnector";
import { Entity } from "@/entity";
import env from "@/env";
import logger from "@/logger";
import { getDecimalPlaces } from "@/util/dataTransformUtil";
import {
  convertUnitForCumulativeElectricEnergy,
  createEchonetMessage,
  EchonetData,
  getEdt,
  parseEchonetMessage,
} from "@/util/echonetUtil";

export type SmartMeterClient = {
  deviceId: string;
  entities: Entity[];
  addListener: (listen: (entityId: string, value: string) => void) => void;
  request: () => Promise<void>;
  close: () => Promise<void>;
};

export default async function initializeSmartMeterClient(): Promise<SmartMeterClient> {
  const wiSunConnector = createWiSunConnector(
    env.WISUN_CONNECTOR,
    env.WISUN_DEVICE,
  );
  await wiSunConnector.reset();
  await wiSunConnector.setAuth(env.ROUTE_B_ID, env.ROUTE_B_PASSWORD);
  await wiSunConnector.scanAndJoin(env.WISUN_SCAN_RETRIES);

  wiSunConnector.on("error", (err) => logger.error("[SmartMeter] Error:", err));

  const getEchonetLite = async (epcs: number[]): Promise<EchonetData> => {
    const requestMessage = createEchonetMessage({
      seoj: 0x028801, // スマートメーター
      deoj: 0x05ff01, // コントローラー
      esv: 0x62, // GET命令
      tid: 0x0001, // 任意
      properties: epcs.map((epc) => ({ epc, pdc: 1, edt: 0 })),
    });

    const responseData = await wiSunConnector.sendEchonetLite(requestMessage);

    return parseEchonetMessage(responseData);
  };

  // エンティティの構成に必要なプロパティを要求
  const initialData = await getEchonetLite([
    0x8a, // メーカーコード
    0x8d, // 製造番号
    0xe1, // 積算電力量単位 (正方向、逆方向計測値)
    0xd3, // 係数
  ]);
  // 積算電力量単位
  const cumulativeMultiplier = convertUnitForCumulativeElectricEnergy(
    getEdt(initialData, 0xe1),
  );
  // 係数
  const cumulativeCoefficient = getEdt(initialData, 0xd3);
  // 係数から精度を求める
  const cumulativeUnitPrecision = getDecimalPlaces(cumulativeMultiplier);
  // メーカー
  const manufacturer = getEdt(initialData, 0x8a);
  // 製造番号
  const serialNumber = getEdt(initialData, 0x8d);

  const deviceId = `${manufacturer}_${serialNumber}`;
  const entities: Entity[] = [];

  // Home Assistantに登録するエンティティ
  entities.push({
    id: "operationStatus",
    name: "動作状態",
    domain: "binary_sensor",
    deviceClass: "running",
    epc: 0x80,
    converter: (value) => (value === 0x30 ? "ON" : "OFF"),
  });
  entities.push({
    id: "faultStatus",
    name: "異常発生状態",
    domain: "binary_sensor",
    deviceClass: "problem",
    epc: 0x88,
    converter: (value) => (value === 0x41 ? "OFF" : "ON"),
  });
  entities.push({
    id: "instantaneousElectricPower",
    name: "瞬時電力計測値",
    domain: "sensor",
    deviceClass: "power",
    stateClass: "measurement",
    unit: "W",
    nativeValue: "int",
    epc: 0xe7,
    converter: (value) => String(value),
  });
  entities.push({
    id: "instantaneousCurrent",
    name: "瞬時電流計測値",
    domain: "sensor",
    deviceClass: "current",
    stateClass: "total_increasing",
    unit: "A",
    nativeValue: "float",
    unitPrecision: 1,
    epc: 0xe8,
    converter: (value) => String(value * 0.1),
  });
  entities.push({
    id: "normalDirectionCumulativeElectricEnergy",
    name: "積算電力量計測値 (正方向計測値)",
    domain: "sensor",
    deviceClass: "energy",
    stateClass: "total_increasing",
    unit: "kWh",
    nativeValue: "float",
    unitPrecision: cumulativeUnitPrecision,
    epc: 0xe0,
    converter: (value) =>
      String(value * cumulativeMultiplier * cumulativeCoefficient),
  });
  entities.push({
    id: "reverseDirectionCumulativeElectricEnergy",
    name: "積算電力量計測値 (逆方向計測値)",
    domain: "sensor",
    deviceClass: "energy",
    stateClass: "total_increasing",
    unit: "kWh",
    nativeValue: "float",
    unitPrecision: cumulativeUnitPrecision,
    epc: 0xe3,
    converter: (value) =>
      String(value * cumulativeMultiplier * cumulativeCoefficient),
  });

  // エンティティの更新を通知するリスナー
  const addListener = (listener: (entityId: string, value: string) => void) => {
    wiSunConnector.on("message", (message: Buffer) => {
      const { properties } = parseEchonetMessage(message);
      properties.forEach(({ epc, edt }) => {
        const entity = entities.find((entity) => entity.epc === epc);
        if (!entity) {
          return;
        }
        listener(entity.id, entity.converter(edt));
      });
    });
  };

  const request = async () => {
    await getEchonetLite([
      0x80, // 動作状態
      0x88, // 異常発生状態
      0xe7, // 瞬時電力計測値
      0xe8, // 瞬時電流計測値
      0xe0, // 積算電力量計測値 (正方向計測値)
      0xe3, // 積算電力量計測値 (逆方向計測値)
    ]);
  };

  return {
    deviceId,
    entities,
    addListener,
    request,
    close: () => wiSunConnector.close(),
  };
}
