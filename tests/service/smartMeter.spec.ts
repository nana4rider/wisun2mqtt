import type { PanInfo, WiSunConnector } from "@/connector/WiSunConnector";
import { EchonetData } from "@/echonet/EchonetData";
import env from "@/env";
import logger from "@/logger";
import initializeSmartMeterClient, {
  initializeWiSunConnector,
} from "@/service/smartMeter";
import assert from "assert";
import fileExists from "file-exists";
import { readFile, writeFile } from "fs/promises";
import type { CancelablePromise } from "p-event";
import { pEvent } from "p-event";
import type { Writable } from "type-fest";

const writableEnv: Writable<typeof env> = env;

const mockWiSunConnector: WiSunConnector = {
  on: vi.fn(),
  setAuth: vi.fn(),
  scan: vi.fn(),
  join: vi.fn(),
  sendEchonetLite: vi.fn(),
  getPanInfo: vi.fn(),
  close: vi.fn(),
};

vi.mock("@/connector/WiSunConnector", () => ({
  default: () => mockWiSunConnector,
}));

vi.mock("file-exists", () => ({
  default: vi.fn(),
}));

vi.mock("node:fs/promises");

vi.mock("p-event", () => ({
  pEvent: vi.fn(),
}));

const mockPanInfo: PanInfo = {
  Channel: "00",
  "Channel Page": "00",
  "Pan ID": "FFFF",
  Addr: "0000111122223333",
  LQI: "FF",
  Side: "0",
  PairID: "00001234",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mockWiSunConnector.getPanInfo).mockReturnValue(mockPanInfo);
});

function implementFileExists(exists: boolean) {
  vi.mocked<(filepath: string) => Promise<boolean>>(
    fileExists,
  ).mockResolvedValue(exists);
}

describe("initializeWiSunConnector", () => {
  test("接続成功時、WiSunConnectorを返す", async () => {
    implementFileExists(false);
    vi.mocked(mockWiSunConnector.scan).mockResolvedValue(mockPanInfo);

    const wiSunConnector = await initializeWiSunConnector();

    expect(mockWiSunConnector.setAuth).toHaveBeenCalledExactlyOnceWith(
      env.ROUTE_B_ID,
      env.ROUTE_B_PASSWORD,
    );
    expect(mockWiSunConnector.scan).toHaveBeenCalledExactlyOnceWith(
      env.WISUN_SCAN_RETRIES,
    );
    expect(mockWiSunConnector.join).toHaveBeenCalledExactlyOnceWith(
      mockPanInfo,
    );
    expect(wiSunConnector).toEqual(mockWiSunConnector);
  });

  test("接続成功時、Pan情報がキャッシュされる", async () => {
    implementFileExists(false);
    vi.mocked(mockWiSunConnector.scan).mockResolvedValue(mockPanInfo);

    await initializeWiSunConnector();

    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      env.PAN_INFO_PATH,
      JSON.stringify(mockPanInfo),
    );
  });

  test("キャッシュされたPan情報で接続に成功するとスキャンしない", async () => {
    implementFileExists(true);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockPanInfo));

    await initializeWiSunConnector();

    expect(mockWiSunConnector.scan).not.toHaveBeenCalled();
    expect(mockWiSunConnector.join).toHaveBeenCalledTimes(1);
    expect(mockWiSunConnector.join).toHaveBeenCalledExactlyOnceWith(
      mockPanInfo,
    );
  });

  test("キャッシュされたPan情報で接続に失敗するとスキャンしてjoinを試みる", async () => {
    implementFileExists(true);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ invalid: "panInfo" }),
    );
    vi.mocked(mockWiSunConnector.join).mockRejectedValueOnce(
      new Error("join failed"),
    );
    vi.mocked(mockWiSunConnector.scan).mockResolvedValue(mockPanInfo);

    await initializeWiSunConnector();

    expect(mockWiSunConnector.join).toHaveBeenCalledTimes(2);
    expect(mockWiSunConnector.scan).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalled();
  });

  test("接続処理中に致命的な問題が発生するとコネクションをクローズする", async () => {
    vi.mocked(mockWiSunConnector.setAuth).mockRejectedValue(
      new Error("setAuth error"),
    );

    const actual = initializeWiSunConnector();

    await expect(actual).rejects.toThrow();
    expect(mockWiSunConnector.close).toHaveBeenCalled();
  });

  test("WiSunConnectorのエラーイベントが発火されたとき、エラーログを出力する", async () => {
    implementFileExists(true);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockPanInfo));
    const logErrorSpy = vi.spyOn(logger, "error");
    const wiSunConnector = await initializeWiSunConnector();

    const handleError = vi.mocked<
      (event: "error", listener: (err: Error) => void) => WiSunConnector
    >(wiSunConnector.on).mock.calls[0][1];
    handleError(new Error("on error"));

    expect(logErrorSpy).toHaveBeenCalledExactlyOnceWith(
      "[SmartMeter] Error:",
      expect.any(Error),
    );
  });
});

describe("initializeSmartMeterClient", () => {
  beforeEach(() => {
    writableEnv.ECHONET_GET_RETRIES = 0;
    // initializeWiSunConnector
    implementFileExists(false);
    vi.mocked(mockWiSunConnector.scan).mockResolvedValue(mockPanInfo);
    // tid固定
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  test("必要なエンティティが作成される", async () => {
    const mockResponseBuffer = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x72,
      tid: 0x00,
      properties: [
        { epc: 0xe1, edt: 0x1 },
        { epc: 0xd3, edt: 0x1 },
        { epc: 0x8a, edt: 0x16 },
      ],
    }).toBuffer();

    vi.mocked(pEvent).mockResolvedValue(mockResponseBuffer);

    const { device } = await initializeSmartMeterClient();
    expect(device.deviceId).toBe("smartMeter_0000111122223333");
    expect(device.manufacturer).toBe("000016");
    expect(device.entities).toEqual([
      {
        converter: expect.any(Function) as (value: number) => string,
        deviceClass: "running",
        domain: "binary_sensor",
        epc: 128,
        id: "operationStatus",
        name: "動作状態",
      },
      {
        converter: expect.any(Function) as (value: number) => string,
        deviceClass: "problem",
        domain: "binary_sensor",
        epc: 136,
        id: "faultStatus",
        name: "異常発生状態",
      },
      {
        converter: expect.any(Function) as (value: number) => string,
        deviceClass: "power",
        domain: "sensor",
        epc: 231,
        id: "instantaneousElectricPower",
        name: "瞬時電力計測値",
        nativeValue: "int",
        stateClass: "measurement",
        unit: "W",
      },
      {
        converter: expect.any(Function) as (value: number) => string,
        deviceClass: "current",
        domain: "sensor",
        epc: 232,
        id: "instantaneousCurrent",
        name: "瞬時電流計測値 (R相)",
        nativeValue: "float",
        stateClass: "measurement",
        unit: "A",
        unitPrecision: 1,
      },
      {
        converter: expect.any(Function) as (value: number) => string,
        deviceClass: "current",
        domain: "sensor",
        epc: 232,
        id: "instantaneousCurrent",
        name: "瞬時電流計測値 (T相)",
        nativeValue: "float",
        stateClass: "measurement",
        unit: "A",
        unitPrecision: 1,
      },
      {
        converter: expect.any(Function) as (value: number) => string,
        deviceClass: "energy",
        domain: "sensor",
        epc: 224,
        id: "normalDirectionCumulativeElectricEnergy",
        name: "積算電力量計測値 (正方向計測値)",
        nativeValue: "float",
        stateClass: "total_increasing",
        unit: "kWh",
        unitPrecision: 1,
      },
      {
        converter: expect.any(Function) as (value: number) => string,
        deviceClass: "energy",
        domain: "sensor",
        epc: 227,
        id: "reverseDirectionCumulativeElectricEnergy",
        name: "積算電力量計測値 (逆方向計測値)",
        nativeValue: "float",
        stateClass: "total_increasing",
        unit: "kWh",
        unitPrecision: 1,
      },
    ]);
  });

  test("converterが正しく動作している", async () => {
    const mockResponseBuffer = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x72,
      tid: 0x00,
      properties: [
        { epc: 0xe1, edt: 0x1 },
        { epc: 0xd3, edt: 0x1 },
        { epc: 0x8a, edt: 0x16 },
      ],
    }).toBuffer();

    vi.mocked(pEvent).mockResolvedValue(mockResponseBuffer);

    const { device } = await initializeSmartMeterClient();
    // 動作状態
    expect(device.entities[0].converter(0x30)).toBe("ON");
    expect(device.entities[0].converter(0x31)).toBe("OFF");
    // 異常発生状態
    expect(device.entities[1].converter(0x42)).toBe("OFF");
    expect(device.entities[1].converter(0x41)).toBe("ON");
    // 瞬時電力計測値
    expect(device.entities[2].converter(100)).toBe("100");
    // 瞬時電流計測値 (R相)
    expect(device.entities[3].converter(0xaaaabbbb)).toBe("4369.0");
    // 瞬時電流計測値 (T相)
    expect(device.entities[4].converter(0xaaaabbbb)).toBe("4805.9");
    expect(device.entities[4].converter(0xaaaa7ffe)).toBe("0");
    // 積算電力量計測値 (正方向計測値)
    expect(device.entities[5].converter(100)).toBe("10");
    // 積算電力量計測値 (逆方向計測値)
    expect(device.entities[6].converter(200)).toBe("20");
  });

  test("GET要求に対しての返信ではない場合filterがfalseを返す", async () => {
    const mockResponseBuffer = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x72,
      tid: 0x99, // GET要求とは異なるtid
      properties: [],
    }).toBuffer();

    let actual;
    vi.mocked(pEvent).mockImplementation(() => {
      const option = vi.mocked(pEvent).mock.calls[0][2];
      assert(typeof option?.filter === "function");
      actual = option.filter(mockResponseBuffer);
      return Promise.resolve() as CancelablePromise<void>;
    });

    const promiseInitialize = initializeSmartMeterClient();

    await expect(promiseInitialize).rejects.toThrow();
    expect(actual).toBe(false);
  });

  test("GET要求に対しての返信がエラーの場合例外をスローする", async () => {
    const mockResponseBuffer = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x52, // エラー応答
      tid: 0x00,
      properties: [],
    }).toBuffer();

    vi.mocked(pEvent).mockResolvedValue(mockResponseBuffer);

    const actual = initializeSmartMeterClient();

    await expect(actual).rejects.toThrow();
  });

  test("GET要求に対しての返信がエラーの場合、指定回数リトライされる", async () => {
    writableEnv.ECHONET_GET_RETRIES = 2;
    const mockResponseBuffer = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x52, // エラー応答
      tid: 0x00,
      properties: [],
    }).toBuffer();

    vi.mocked(pEvent).mockResolvedValue(mockResponseBuffer);

    const actual = initializeSmartMeterClient();

    await expect(actual).rejects.toThrow();
    expect(pEvent).toHaveBeenCalledTimes(3);
  });

  test("GET要求に対しての返信がエラーの場合、次回呼び出し時に再接続する", async () => {
    const mockResponseSuccessBuffer = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x72,
      tid: 0x00,
      properties: [
        { epc: 0xe1, edt: 0x1 },
        { epc: 0xd3, edt: 0x1 },
        { epc: 0x8a, edt: 0x16 },
      ],
    }).toBuffer();
    const mockResponseFailureBuffer = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x52,
      tid: 0x00,
      properties: [],
    }).toBuffer();

    vi.mocked(pEvent)
      .mockResolvedValueOnce(mockResponseSuccessBuffer)
      .mockResolvedValueOnce(mockResponseFailureBuffer)
      .mockResolvedValueOnce(mockResponseSuccessBuffer);

    const { fetchData } = await initializeSmartMeterClient();
    await fetchData([0x00]).catch(() => {});
    await fetchData([0x00]);

    expect(mockWiSunConnector.join).toHaveBeenCalledTimes(2);
  });

  test("closeメソッドを呼び出すとwiSunConnectorがクローズされる", async () => {
    const mockResponseBuffer = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x72,
      tid: 0x00,
      properties: [
        { epc: 0xe1, edt: 0x1 },
        { epc: 0xd3, edt: 0x1 },
        { epc: 0x8a, edt: 0x16 },
      ],
    }).toBuffer();

    vi.mocked(pEvent).mockResolvedValue(mockResponseBuffer);

    const { close } = await initializeSmartMeterClient();
    await close();

    expect(mockWiSunConnector.close).toHaveBeenCalled();
  });
});
