import { convertUnitForCumulativeElectricEnergy } from "@/echonet/echonetHelper";

describe("convertUnitForCumulativeElectricEnergy", () => {
  test("単位が変換できる", () => {
    const unit = convertUnitForCumulativeElectricEnergy(0x02);

    expect(unit).toBe(0.01);
  });

  test("引数が不正な場合例外をスローする", () => {
    const actual = () => convertUnitForCumulativeElectricEnergy(0xff);

    expect(actual).toThrow();
  });
});
