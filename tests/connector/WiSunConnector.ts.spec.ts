import { BP35Connector } from "@/connector/BP35Connector";
import { createWiSunConnector, isPanInfo } from "@/connector/WiSunConnector";
import type { WiSunConnectorModel } from "@/connector/WiSunConnectorModel";

vi.mock("@/connector/BP35Connector");

describe("isPanInfo", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("非オブジェクトである", () => {
    const obj = 123;

    const result = isPanInfo(obj);

    expect(result).toBe(false);
  });

  test("nullである", () => {
    const obj = null;

    const result = isPanInfo(obj);

    expect(result).toBe(false);
  });

  test("必要なキーが揃っていない", () => {
    const obj = {
      Addr: "Addr",
    };

    const result = isPanInfo(obj);

    expect(result).toBe(false);
  });

  test("必要なキーが揃っている", () => {
    const obj = {
      Channel: "00",
      PanID: "FFFF",
      Addr: "0000111122223333",
    };

    const result = isPanInfo(obj);

    expect(result).toBe(true);
  });
});

describe("createWiSunConnector", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("side指定ありモデルのインスタンスを取得できる", () => {
    const MockBP35Connector = vi.mocked(BP35Connector);

    const wiSunConnector = createWiSunConnector("BP35C2", "devicePath");

    expect(MockBP35Connector).toHaveBeenCalledExactlyOnceWith(
      "devicePath",
      true,
    );
    expect(wiSunConnector).toBeInstanceOf(BP35Connector);
  });

  test("side指定なしモデルのインスタンスを取得できる", () => {
    const MockBP35Connector = vi.mocked(BP35Connector);

    const wiSunConnector = createWiSunConnector("BP35A1", "devicePath");

    expect(MockBP35Connector).toHaveBeenCalledExactlyOnceWith(
      "devicePath",
      false,
    );
    expect(wiSunConnector).toBeInstanceOf(BP35Connector);
  });

  test("不正なモデルの場合例外をスローする", () => {
    vi.mocked(BP35Connector);

    const actual = () =>
      createWiSunConnector("unknown" as WiSunConnectorModel, "devicePath");

    expect(actual).toThrow();
  });
});
