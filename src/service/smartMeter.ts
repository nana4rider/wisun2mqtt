import type { PanInfo, WiSunConnector } from "@/connector/WiSunConnector";
import createWiSunConnector from "@/connector/WiSunConnector";
import { EchonetData } from "@/echonet/EchonetData";
import { convertUnitForCumulativeElectricEnergy } from "@/echonet/echonetHelper";
import type { Entity } from "@/entity";
import env from "@/env";
import logger from "@/logger";
import { getDecimalPlaces, parseJson } from "@/util/dataTransformUtil";
import assert from "assert";
import fileExists from "file-exists";
import { readFile, writeFile } from "fs/promises";
import { pEvent } from "p-event";

export type SmartMeterClient = {
  device: {
    deviceId: string;
    manufacturer: string;
    entities: Entity[];
  };
  fetchData: (epcs: number[]) => Promise<EchonetData>;
  close: () => Promise<void>;
};

export default async function initializeSmartMeterClient(): Promise<SmartMeterClient> {
  let wiSunConnector: WiSunConnector | undefined =
    await initializeWiSunConnector();

  const fetchData = async (epcs: number[]): Promise<EchonetData> => {
    const requestData = EchonetData.create({
      seoj: 0x05ff01, // コントローラー
      deoj: 0x028801, // スマートメーター
      esv: 0x62, // GET命令
      properties: epcs.map((epc) => ({ epc })),
    });

    if (!wiSunConnector) {
      wiSunConnector = await initializeWiSunConnector();
    }

    const maxRetries = env.ECHONET_GET_RETRIES;
    for (let retries = 0; retries <= maxRetries; retries++) {
      try {
        await wiSunConnector.sendEchonetLite(requestData.toBuffer());

        const responseData = await pEvent<"message", Buffer>(
          wiSunConnector,
          "message",
          {
            filter: (frame) => {
              const data = EchonetData.parse(frame);
              // GET要求に対しての返信である
              return requestData.isValidResponse(data);
            },
            timeout: env.ECHONET_GET_TIMEOUT,
          },
        ).then((frame) => EchonetData.parse(frame));

        if (responseData.esv === 0x72) {
          // 正常終了
          logger.debug(
            `[SmartMeter] Receive message: ${responseData.toString()}`,
          );
        } else {
          // エラー
          logger.error(
            `[SmartMeter] Receive message Error: ${responseData.toString()}`,
          );
          throw new Error(`Receive message Error: ${responseData.esv}`);
        }

        return responseData;
      } catch (err) {
        if (retries < maxRetries) {
          logger.warn(
            `[SmartMeter] Error occurred, retrying... (${retries + 1}/${maxRetries})`,
          );
          logger.debug("err:", err);
        }
      }
    }

    // リトライしても失敗する場合は接続に問題が起きている可能性が高いので、次回実行時に再接続する
    await wiSunConnector.close();
    wiSunConnector = undefined;
    throw new Error("[SmartMeter] Failed to fetch data after all retries.");
  };

  // エンティティの構成に必要なプロパティを要求
  const initialData = await fetchData([
    0xe1, // 積算電力量単位 (正方向、逆方向計測値)
    0xd3, // 係数
    0x8a, // メーカー
  ]);
  // 積算電力量単位
  const cumulativeMultiplier = convertUnitForCumulativeElectricEnergy(
    initialData.getEdt(0xe1),
  );
  // 係数
  const cumulativeCoefficient = initialData.getEdt(0xd3);
  // 係数から精度を求める
  const cumulativeUnitPrecision = getDecimalPlaces(cumulativeMultiplier);

  assert(wiSunConnector);
  const panInfo = wiSunConnector.getPanInfo();

  const deviceId = `smartMeter_${panInfo.Addr}`;
  const manufacturer = initialData.getEdt(0x8a).toString(16).padStart(6, "0");
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
    converter: (value) => (value === 0x42 ? "OFF" : "ON"),
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
    name: "瞬時電流計測値 (R相)",
    domain: "sensor",
    deviceClass: "current",
    stateClass: "measurement",
    unit: "A",
    nativeValue: "float",
    unitPrecision: 1,
    epc: 0xe8,
    converter: (value) => {
      const rPhase = (value >> 16) & 0xffff;
      return (rPhase * 0.1).toFixed(1);
    },
  });
  entities.push({
    id: "instantaneousCurrent",
    name: "瞬時電流計測値 (T相)",
    domain: "sensor",
    deviceClass: "current",
    stateClass: "measurement",
    unit: "A",
    nativeValue: "float",
    unitPrecision: 1,
    epc: 0xe8,
    converter: (value) => {
      const tPhase = value & 0xffff;
      return tPhase === 0x7ffe ? "0" : (tPhase * 0.1).toFixed(1);
    },
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

  return {
    device: {
      deviceId,
      manufacturer,
      entities,
    },
    fetchData,
    close: async () => await wiSunConnector?.close(),
  };
}

// export for test
export async function initializeWiSunConnector() {
  const wiSunConnector = createWiSunConnector(
    env.WISUN_CONNECTOR_MODEL,
    env.WISUN_CONNECTOR_DEVICE_PATH,
  );
  wiSunConnector.on("error", (err) => logger.error("[SmartMeter] Error:", err));

  try {
    await wiSunConnector.setAuth(env.ROUTE_B_ID, env.ROUTE_B_PASSWORD);

    // Pan情報のキャッシュがあれば使う
    if (await fileExists(env.PAN_INFO_PATH)) {
      try {
        const cachedPanInfoText = await readFile(env.PAN_INFO_PATH, "utf8");
        if (cachedPanInfoText.length !== 0) {
          const panInfo: PanInfo = parseJson(cachedPanInfoText);
          await wiSunConnector.join(panInfo);
          logger.info("[SmartMeter] キャッシュされたPan情報で接続成功");

          return wiSunConnector;
        }
      } catch (err) {
        logger.warn("[SmartMeter] キャッシュされたPan情報で接続失敗");
        logger.debug("err:", err);
      }
    }

    const panInfo = await wiSunConnector.scan(env.WISUN_SCAN_RETRIES);
    await wiSunConnector.join(panInfo);
    await writeFile(env.PAN_INFO_PATH, JSON.stringify(panInfo));

    return wiSunConnector;
  } catch (err) {
    logger.error(`initializeWiSunConnector:`, err);
    await wiSunConnector.close();
    throw err;
  }
}
