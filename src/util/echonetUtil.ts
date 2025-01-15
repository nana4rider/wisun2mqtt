import { Buffer } from "buffer";

export interface EchonetData {
  tid: number; // トランザクションID
  seoj: number; // 送信元オブジェクト
  deoj: number; // 宛先オブジェクト
  esv: number; // サービスコード
  properties: EchonetProperty[]; // プロパティリスト
}

export interface EchonetProperty {
  edt: number; // データ
  epc: number; // プロパティ
  pdc: number; // データ長
}

export function createEchonetMessage(data: EchonetData): Buffer {
  const tidBuffer = Buffer.alloc(2);
  tidBuffer.writeUInt16BE(data.tid, 0);
  const seojBuffer = Buffer.alloc(3);
  seojBuffer.writeUIntBE(data.seoj, 0, 3);
  const deojBuffer = Buffer.alloc(3);
  deojBuffer.writeUIntBE(data.deoj, 0, 3);

  const opc = Buffer.from([data.properties.length]);
  const propertyData = Buffer.concat(
    data.properties.map(({ epc, pdc, edt }) => {
      const edtBuffer = Buffer.alloc(pdc);
      edtBuffer.writeUIntBE(edt, 0, pdc); // Big-endianで書き込み
      return Buffer.concat([Buffer.from([epc]), Buffer.from([pdc]), edtBuffer]);
    }),
  );

  return Buffer.concat([
    Buffer.from([0x10, 0x81]), // ECHONET Lite 固定ヘッダー
    tidBuffer,
    seojBuffer,
    deojBuffer,
    Buffer.from([data.esv]), // サービスコード
    opc, // プロパティ数
    propertyData, // プロパティデータ
  ]);
}

export function parseEchonetMessage(message: Buffer): EchonetData {
  if (message.length < 12) {
    throw new Error("Invalid frame: Frame is too short.");
  }

  const tid = message.readUInt16BE(2); // トランザクションID
  const seoj = message.readUIntBE(4, 3); // 送信元オブジェクト
  const deoj = message.readUIntBE(7, 3); // 宛先オブジェクト
  const esv = message.readUInt8(10); // サービスコード
  const opc = message.readUInt8(11); // プロパティ数

  if (opc === 0) {
    throw new Error("Invalid frame: No properties found.");
  }

  const properties: EchonetProperty[] = [];
  let offset = 12;

  for (let i = 0; i < opc; i++) {
    if (message.length < offset + 2) {
      throw new Error("Invalid frame: EPC or PDC is missing.");
    }

    const epc = message.readUInt8(offset); // プロパティコード
    offset += 1;

    const pdc = message.readUInt8(offset); // データ長
    offset += 1;

    if (message.length < offset + pdc) {
      throw new Error("Invalid frame: EDT is incomplete.");
    }

    const edt = message.readUIntBE(offset, pdc); // プロパティデータ
    offset += pdc;

    properties.push({ epc, pdc, edt });
  }

  return {
    tid,
    seoj,
    deoj,
    esv,
    properties,
  };
}

export function convertUnitForCumulativeElectricEnergy(value: number): number {
  const valueMap: { [key: number]: number } = {
    0x00: 1,
    0x01: 0.1,
    0x02: 0.01,
    0x03: 0.001,
    0x04: 0.0001,
    0x0a: 10,
    0x0b: 100,
    0x0c: 1000,
    0x0d: 10000,
  };

  if (!(value in valueMap)) {
    throw new Error(`Invalid E1 value: ${value}`);
  }

  return valueMap[value];
}

export function getEdt(echonetData: EchonetData, epc: number): number {
  const property = echonetData.properties.find(
    (property) => property.epc === epc,
  );
  if (!property) throw new Error(`Property not found.: ${epc}`);
  return property.edt;
}
