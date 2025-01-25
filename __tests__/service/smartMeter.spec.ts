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

const mockOn = jest.fn();
const mockSetAuth = jest.fn();
const mockScan = jest.fn();
const mockJoin = jest.fn();
const mockSendEchonetLite = jest.fn();
const mockClose = jest.fn();
const mockWiSunConnector: WiSunConnector = {
  on: mockOn,
  setAuth: mockSetAuth,
  scan: mockScan,
  join: mockJoin,
  sendEchonetLite: mockSendEchonetLite,
  close: mockClose,
};

jest.mock("@/connector/WiSunConnector", () => ({
  __esModule: true,
  default: () => mockWiSunConnector,
}));

jest.mock("file-exists", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("fs/promises", () => {
  const actual = jest.requireActual<typeof fsPromises>("fs/promises");
  return {
    ...actual,
    readFile: jest.fn(),
    writeFile: jest.fn(),
  };
});

jest.mock("p-event", () => ({
  pEvent: jest.fn(),
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
  jest.resetAllMocks();
});

describe("initializeWiSunConnector", () => {
  test("接続成功時、WiSunConnectorとPanInfoを返す", async () => {
    (fileExists as unknown as jest.Mock).mockResolvedValue(false);
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
    (fileExists as unknown as jest.Mock).mockResolvedValue(false);
    mockScan.mockResolvedValue(mockPanInfo);

    const { panInfo } = await initializeWiSunConnector();

    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      env.PAN_INFO_PATH,
      JSON.stringify(panInfo),
    );
  });

  test("キャッシュされたPan情報で接続に成功するとスキャンしない", async () => {
    (fileExists as unknown as jest.Mock).mockResolvedValue(true);
    (fsPromises.readFile as jest.Mock).mockResolvedValue(
      JSON.stringify(mockPanInfo),
    );

    await initializeWiSunConnector();

    expect(mockScan).not.toHaveBeenCalled();
    expect(mockJoin).toHaveBeenCalledTimes(1);
    expect(mockJoin).toHaveBeenCalledWith(mockPanInfo);
  });

  test("キャッシュされたPan情報で接続に失敗するとスキャンしてjoinを試みる", async () => {
    (fileExists as unknown as jest.Mock).mockResolvedValue(true);
    (fsPromises.readFile as jest.Mock).mockResolvedValue(
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
    (fileExists as unknown as jest.Mock).mockResolvedValue(true);
    const logErrorSpy = jest.spyOn(logger, "error");
    await initializeWiSunConnector();

    const handleError = (
      mockOn as jest.Mock<
        WiSunConnector,
        [event: "error", listener: (err: Error) => void]
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
    jest.resetAllMocks();
    // initializeWiSunConnector
    (fileExists as unknown as jest.Mock).mockResolvedValue(false);
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

    const mockPEvent = pEvent as unknown as jest.Mock<
      Promise<void>,
      [
        connector: WiSunConnector,
        event: string,
        options: { filter: (frame: Buffer) => boolean },
      ]
    >;

    // tid固定
    jest.spyOn(Math, "random").mockReturnValue(0);

    mockPEvent.mockImplementation(() => {
      const option = mockPEvent.mock.calls[0][2];
      option.filter(mockResponseBuffer);
      return Promise.resolve();
    });

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

    const mockPEvent = pEvent as unknown as jest.Mock<
      Promise<void>,
      [
        connector: WiSunConnector,
        event: string,
        options: { filter: (frame: Buffer) => boolean },
      ]
    >;

    // tid固定
    jest.spyOn(Math, "random").mockReturnValue(0);

    mockPEvent.mockImplementation(() => {
      const option = mockPEvent.mock.calls[0][2];
      option.filter(mockResponseBuffer);
      return Promise.resolve();
    });

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

    const mockPEvent = pEvent as unknown as jest.Mock<
      Promise<void>,
      [
        connector: WiSunConnector,
        event: string,
        options: { filter: (frame: Buffer) => boolean },
      ]
    >;

    // tid固定
    jest.spyOn(Math, "random").mockReturnValue(0);

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

  test("GET要求に対しての返信がエラーの場合filterがfalseを返す", async () => {
    const mockResponseBuffer = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x52, // エラー応答
      tid: 0x00,
      properties: [],
    }).toBuffer();

    const mockPEvent = pEvent as unknown as jest.Mock<
      Promise<void>,
      [
        connector: WiSunConnector,
        event: string,
        options: { filter: (frame: Buffer) => boolean },
      ]
    >;

    // tid固定
    jest.spyOn(Math, "random").mockReturnValue(0);

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

  test("Pan情報のAddrがない場合に例外をすろーする", async () => {
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

    const mockPEvent = pEvent as unknown as jest.Mock<
      Promise<void>,
      [
        connector: WiSunConnector,
        event: string,
        options: { filter: (frame: Buffer) => boolean },
      ]
    >;

    // tid固定
    jest.spyOn(Math, "random").mockReturnValue(0);

    mockPEvent.mockImplementation(() => {
      const option = mockPEvent.mock.calls[0][2];
      option.filter(mockResponseBuffer);
      return Promise.resolve();
    });

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

    const mockPEvent = pEvent as unknown as jest.Mock<
      Promise<void>,
      [
        connector: WiSunConnector,
        event: string,
        options: { filter: (frame: Buffer) => boolean },
      ]
    >;

    // tid固定
    jest.spyOn(Math, "random").mockReturnValue(0);

    mockPEvent.mockImplementation(() => {
      const option = mockPEvent.mock.calls[0][2];
      option.filter(mockResponseBuffer);
      return Promise.resolve();
    });

    const { close } = await initializeSmartMeterClient();
    await close();

    expect(mockWiSunConnector.close).toHaveBeenCalled();
  });
});
