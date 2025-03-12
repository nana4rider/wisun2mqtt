import {
  getDecimalPlaces,
  hex2ascii,
  parseJson,
} from "@/util/dataTransformUtil";

describe("hex2ascii", () => {
  test("正しく変換できる", () => {
    const actual = hex2ascii("666f6f626172");

    expect(actual).toBe("foobar");
  });
});

describe("getDecimalPlaces", () => {
  test("小数点あり", () => {
    const actual = getDecimalPlaces(12.345);

    expect(actual).toBe(3);
  });

  test("小数点なし", () => {
    const actual = getDecimalPlaces(1234);

    expect(actual).toBe(0);
  });
});

describe("parseJson", () => {
  test("変換できる", () => {
    const actual = parseJson(`{"foo":1,"bar":"2"}`);

    expect(actual).toEqual({
      foo: 1,
      bar: "2",
    });
  });

  test("小数点なし", () => {
    const actual = getDecimalPlaces(1234);

    expect(actual).toBe(0);
  });
});
