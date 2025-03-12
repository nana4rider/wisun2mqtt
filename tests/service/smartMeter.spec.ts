import { PanInfo, WiSunConnector } from "@/connector/WiSunConnector";
import { EchonetData } from "@/echonet/EchonetData";
import env from "@/env";
import logger from "@/logger";
import initializeSmartMeterClient, {
  initializeWiSunConnector,
} from "@/service/smartMeter";
import fileExists from "file-exists";
import * as fsPromises from "fs/promises";
import { pEvent } from "p-event";
import { Writable } from "type-fest";
import { Mock } from "vitest";

const mockOn = vi.fn();
const mockSetAuth = vi.fn();
const mockScan = vi.fn();
const mockJoin = vi.fn();
const mockSendEchonetLite = vi.fn();
const mockClose = vi.fn();
const mockWiSunConnector: WiSunConnector = {
  on: mockOn,
  setAuth: mockSetAuth,
  scan: mockScan,
  join: mockJoin,
  sendEchonetLite: mockSendEchonetLite,
  close: mockClose,
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
  (env as Writable<typeof env>).ECHONET_GET_RETRIES = 0;
  vi.resetAllMocks();
});

describe("initializeWiSunConnector", () => {
  test("接続成功時、WiSunConnectorとPanInfoを返す", async () => {
    (fileExists as unknown as Mock).mockResolvedValue(false);
    mockScan.mockResolvedValue(mockPanInfo);

    const { wiSunConnector, panInfo } = await initializeWiSunConnector();

    expect(mockSetAuth).toHaveBeenCalledWith(
      env.ROUTE_B_ID,
      env.ROUTE_B_PASSWORD,
    );
    expect(mockScan).toHaveBeenCalledWith(env.WISUN_SCAN_RETRIES);
    expect(mockJoin).toHaveBeenCalledWith(mockPanInfo);
    expect(wiSunConnector).toEqual(mockWiSunConnector);
    expect(panInfo).toEqual(mockPanInfo);
  });

  test("接続成功時、Pan情報がキャッシュされる", async () => {
    (fileExists as unknown as Mock).mockResolvedValue(false);
    mockScan.mockResolvedValue(mockPanInfo);

    const { panInfo } = await initializeWiSunConnector();

    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      env.PAN_INFO_PATH,
      JSON.stringify(panInfo),
    );
  });

  test("キャッシュされたPan情報で接続に成功するとスキャンしない", async () => {
    (fileExists as unknown as Mock).mockResolvedValue(true);
    (fsPromises.readFile as Mock).mockResolvedValue(
      JSON.stringify(mockPanInfo),
    );

    await initializeWiSunConnector();

    expect(mockScan).not.toHaveBeenCalled();
    expect(mockJoin).toHaveBeenCalledTimes(1);
    expect(mockJoin).toHaveBeenCalledWith(mockPanInfo);
  });

  test("キャッシュされたPan情報で接続に失敗するとスキャンしてjoinを試みる", async () => {
    (fileExists as unknown as Mock).mockResolvedValue(true);
    (fsPromises.readFile as Mock).mockResolvedValue(
      JSON.stringify({ invalid: "panInfo" }),
    );
    mockJoin.mockRejectedValueOnce(new Error("join failed"));
    mockScan.mockResolvedValue(mockPanInfo);

    await initializeWiSunConnector();

    expect(mockJoin).toHaveBeenCalledTimes(2);
    expect(mockScan).toHaveBeenCalledTimes(1);
    expect(fsPromises.writeFile).toHaveBeenCalled();
  });

  test("接続処理中に致命的な問題が発生するとコネクションをクローズする", async () => {
    mockSetAuth.mockRejectedValue(new Error("setAuth error"));

    const actual = initializeWiSunConnector();

    await expect(actual).rejects.toThrow();
    expect(mockClose).toHaveBeenCalled();
  });

  test("WiSunConnectorのエラーイベントが発火されたとき、エラーログを出力する", async () => {
    (fileExists as unknown as Mock).mockResolvedValue(true);
    (fsPromises.readFile as Mock).mockResolvedValue(
      JSON.stringify(mockPanInfo),
    );
    const logErrorSpy = vi.spyOn(logger, "error");
    await initializeWiSunConnector();

    const handleError = (
      mockOn as Mock<
        (event: "error", listener: (err: Error) => void) => WiSunConnector
      >
    ).mock.calls[0][1];
    handleError(new Error("on error"));

    expect(logErrorSpy).toHaveBeenCalledWith(
      "[SmartMeter] Error:",
      expect.any(Error),
    );
  });
});

describe("initializeSmartMeterClient", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // initializeWiSunConnector
    (fileExists as unknown as Mock).mockResolvedValue(false);
    mockScan.mockResolvedValue(mockPanInfo);
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

    const mockPEvent = pEvent as unknown as Mock;

    // tid固定
    vi.spyOn(Math, "random").mockReturnValue(0);

    mockPEvent.mockResolvedValue(mockResponseBuffer);

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
        name: "瞬時電流計測値",
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

    const mockPEvent = pEvent as unknown as Mock;

    // tid固定
    vi.spyOn(Math, "random").mockReturnValue(0);

    mockPEvent.mockResolvedValue(mockResponseBuffer);

    const { device } = await initializeSmartMeterClient();
    // 動作状態
    expect(device.entities[0].converter(0x30)).toBe("ON");
    expect(device.entities[0].converter(0x31)).toBe("OFF");
    // 異常発生状態
    expect(device.entities[1].converter(0x42)).toBe("OFF");
    expect(device.entities[1].converter(0x41)).toBe("ON");
    // 瞬時電力計測値
    expect(device.entities[2].converter(100)).toBe("100");
    // 瞬時電流計測値
    expect(device.entities[3].converter(0xaaaabbbb)).toBe("9174.9");
    expect(device.entities[3].converter(0xaaaa7ffe)).toBe("4369"); // T相なし
    // 積算電力量計測値 (正方向計測値)
    expect(device.entities[4].converter(100)).toBe("10");
    // 積算電力量計測値 (逆方向計測値)
    expect(device.entities[5].converter(200)).toBe("20");
  });

  test("GET要求に対しての返信ではない場合filterがfalseを返す", async () => {
    const mockResponseBuffer = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x72,
      tid: 0x99, // GET要求とは異なるtid
      properties: [],
    }).toBuffer();

    const mockPEvent = pEvent as unknown as Mock<
      (
        connector: WiSunConnector,
        event: string,
        options: { filter: (frame: Buffer) => boolean },
      ) => Promise<void>
    >;

    // tid固定
    vi.spyOn(Math, "random").mockReturnValue(0);

    let actual;
    mockPEvent.mockImplementation(() => {
      const option = mockPEvent.mock.calls[0][2];
      actual = option.filter(mockResponseBuffer);
      return Promise.resolve();
    });

    try {
      await initializeSmartMeterClient();
    } catch (_) {
      // アサーションは無視する
    }

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

    const mockPEvent = pEvent as unknown as Mock;

    // tid固定
    vi.spyOn(Math, "random").mockReturnValue(0);

    mockPEvent.mockResolvedValue(mockResponseBuffer);

    const actual = initializeSmartMeterClient();

    await expect(actual).rejects.toThrow();
  });

  test("GET要求に対しての返信がエラーの場合、指定回数リトライされる", async () => {
    (env as Writable<typeof env>).ECHONET_GET_RETRIES = 2;
    const mockResponseBuffer = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x52, // エラー応答
      tid: 0x00,
      properties: [],
    }).toBuffer();

    const mockPEvent = pEvent as unknown as Mock;

    // tid固定
    vi.spyOn(Math, "random").mockReturnValue(0);

    mockPEvent.mockResolvedValue(mockResponseBuffer);

    const actual = initializeSmartMeterClient();

    await expect(actual).rejects.toThrow();
    expect(mockPEvent).toHaveBeenCalledTimes(3);
  });

  test("Pan情報のAddrがない場合に例外をスローする", async () => {
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

    const mockPEvent = pEvent as unknown as Mock;

    // tid固定
    vi.spyOn(Math, "random").mockReturnValue(0);

    mockPEvent.mockResolvedValue(mockResponseBuffer);

    mockScan.mockClear().mockResolvedValue({
      ...mockPanInfo,
      Addr: undefined,
    });

    const actual = initializeSmartMeterClient();
    await expect(actual).rejects.toThrow("paninfo[Addr] is empty.");
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

    const mockPEvent = pEvent as unknown as Mock;

    // tid固定
    vi.spyOn(Math, "random").mockReturnValue(0);

    mockPEvent.mockResolvedValue(mockResponseBuffer);

    const { close } = await initializeSmartMeterClient();
    await close();

    expect(mockWiSunConnector.close).toHaveBeenCalled();
  });
});
