import { BP35Connector } from "@/connector/BP35Connector";
import createWiSunConnector from "@/connector/WiSunConnector";
import { WiSunConnectorModel } from "@/connector/WiSunConnectorModel";

vi.mock("@/connector/BP35Connector");

describe("createWiSunConnector", () => {
  test("side指定ありモデルのインスタンスを取得できる", () => {
    const MockBP35Connector = vi.mocked(BP35Connector);

    const wiSunConnector = createWiSunConnector("BP35C2", "devicePath");

    expect(MockBP35Connector).toHaveBeenCalledWith("devicePath", 0);
    expect(wiSunConnector).toBeInstanceOf(BP35Connector);
  });

  test("side指定なしモデルのインスタンスを取得できる", () => {
    const MockBP35Connector = vi.mocked(BP35Connector);

    const wiSunConnector = createWiSunConnector("BP35A1", "devicePath");

    expect(MockBP35Connector).toHaveBeenCalledWith("devicePath");
    expect(wiSunConnector).toBeInstanceOf(BP35Connector);
  });

  test("不正なモデルの場合例外をすろーする", () => {
    vi.mocked(BP35Connector);

    const actual = () =>
      createWiSunConnector("unknown" as WiSunConnectorModel, "devicePath");

    expect(actual).toThrow();
  });
});
