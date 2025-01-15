export interface EchonetData<T extends string> {
  tid: string; // トランザクションID
  seoj: string; // 送信元オブジェクト
  deoj: string; // 宛先オブジェクト
  esv: string; // サービスコード
  properties: { [epc in T]: string }; // プロパティリスト
}

export function createEchonetMessage<T extends string>(
  data: EchonetData<T>,
): string {
  const properties = Object.entries(data.properties) as [T, string][]; // 型キャストで明示
  const opc = properties.length.toString(16).padStart(2, "0");
  const propertyData = properties
    .map(([epc, edt]) => {
      const pdc = (edt.length / 2).toString(16).padStart(2, "0");
      return epc + pdc + edt;
    })
    .join("");

  return `1081${data.tid}${data.seoj}${data.deoj}${data.esv}${opc}${propertyData}`;
}

export function parseEchonetMessage<T extends string>(
  message: string,
): EchonetData<T> {
  if (message.length < 14) {
    throw new Error("Invalid frame: Frame is too short.");
  }

  // 基本フィールドの抽出
  const tid = message.substring(4, 8); // トランザクションID
  const seoj = message.substring(8, 14); // 送信元オブジェクト
  const deoj = message.substring(14, 20); // 宛先オブジェクト
  const esv = message.substring(20, 22); // サービスコード

  // プロパティ数 (OPC)
  const opc = parseInt(message.substring(22, 24), 16);
  if (opc === 0) {
    throw new Error("Invalid frame: No properties found.");
  }

  // プロパティの解析
  let offset = 24;
  const properties = {} as { [epc in T]: string };

  for (let i = 0; i < opc; i++) {
    if (message.length < offset + 2) {
      throw new Error("Invalid frame: EPC is missing.");
    }

    const epc = message.substring(offset, offset + 2) as T; // プロパティコード
    offset += 2;

    if (message.length < offset + 2) {
      throw new Error("Invalid frame: PDC is missing.");
    }

    const pdc = parseInt(message.substring(offset, offset + 2), 16); // データ長
    offset += 2;

    if (message.length < offset + pdc * 2) {
      throw new Error("Invalid frame: EDT is incomplete.");
    }

    const edt = message.substring(offset, offset + pdc * 2); // プロパティデータ
    offset += pdc * 2;

    properties[epc] = edt;
  }

  return {
    tid,
    seoj,
    deoj,
    esv,
    properties,
  };
}

export function convertUnitForCumulativeElectricEnergy(value: string): number {
  const valueMap: { [key: string]: number } = {
    "0x00": 1,
    "0x01": 0.1,
    "0x02": 0.01,
    "0x03": 0.001,
    "0x04": 0.0001,
    "0x0A": 10,
    "0x0B": 100,
    "0x0C": 1000,
    "0x0D": 10000,
  };

  if (!(value in valueMap)) {
    throw new Error(`Invalid E1 value: ${value}`);
  }

  return valueMap[value];
}
