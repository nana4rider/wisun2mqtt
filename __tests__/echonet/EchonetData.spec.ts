import { EchonetData } from "@/echonet/EchonetData";

describe("create", () => {
  test("ヘッダ部を正しく設定できる", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [],
    });

    expect(data.seoj).toBe(0x05ff01);
    expect(data.deoj).toBe(0x028801);
    expect(data.esv).toBe(0x62);
    expect(data.tid).toBe(0x99);
  });

  test("tidが空だとランダム付与される", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      properties: [],
    });

    expect(data.tid <= 0xffff && data.tid >= 0x00).toBe(true);
  });

  test("epcがそのまま格納される", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [{ epc: 0x88, edt: 0x00005678 }],
    });

    expect(data.properties[0].epc).toBe(0x88);
  });

  test("edtは最適な値が自動設定される", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [{ epc: 0x88, edt: 0x00005678 }],
    });

    expect(data.properties[0].pdc).toBe(2);
  });

  test("edtが小数だと例外をスローする", () => {
    const actual = () =>
      EchonetData.create({
        seoj: 0x05ff01,
        deoj: 0x028801,
        esv: 0x62,
        tid: 0x99,
        properties: [{ epc: 0x88, edt: 0.123 }],
      });

    expect(actual).toThrow();
  });

  test("edtが負数だと例外をスローする", () => {
    const actual = () =>
      EchonetData.create({
        seoj: 0x05ff01,
        deoj: 0x028801,
        esv: 0x62,
        tid: 0x99,
        properties: [{ epc: 0x88, edt: -123 }],
      });

    expect(actual).toThrow();
  });

  test("edtがnumberでもbigintで格納される", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [{ epc: 0x88, edt: 0x00005678 }],
    });

    expect(data.properties[0].edt).toBe(0x00005678n);
  });

  test("edtがbigintの負数だと例外をスローする", () => {
    const actual = () =>
      EchonetData.create({
        seoj: 0x05ff01,
        deoj: 0x028801,
        esv: 0x62,
        tid: 0x99,
        properties: [{ epc: 0x88, edt: -999999n }],
      });

    expect(actual).toThrow();
  });

  test("edtがbigintだとそのまま格納される", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [{ epc: 0x88, edt: 0x1234n }],
    });

    expect(data.properties[0].edt).toBe(0x1234n);
  });

  test("edtが指定されていないと0で格納される", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [{ epc: 0x88 }],
    });

    expect(data.properties[0].pdc).toBe(1);
    expect(data.properties[0].edt).toBe(0x00n);
  });
});

describe("parse", () => {
  test("ehdが不正な場合エラー", () => {
    const message = Buffer.from("FFFF", "hex");
    const actual = () => EchonetData.parse(message);

    expect(actual).toThrow();
  });

  test("必要なヘッダ部が揃っていない場合はエラー", () => {
    const message = Buffer.from("1081FFFF", "hex");
    const actual = () => EchonetData.parse(message);

    expect(actual).toThrow();
  });

  test("ヘッダ部を正しく解析できる", () => {
    const message = Buffer.from("1081000102880105FF016201E00100", "hex");
    const data = EchonetData.parse(message);

    expect(data.tid).toBe(0x0001);
    expect(data.seoj).toBe(0x028801);
    expect(data.deoj).toBe(0x05ff01);
    expect(data.esv).toBe(0x62);
    expect(data.properties.length).toBe(1);
  });

  test("EPCが途中で欠落している場合はエラー", () => {
    const message = Buffer.from("1081000102880105FF016201E0", "hex");
    const actual = () => EchonetData.parse(message);

    expect(actual).toThrow();
  });

  test("EDTが途中で欠落している場合はエラー", () => {
    const message = Buffer.from("1081000102880105FF016201E00200", "hex");
    const actual = () => EchonetData.parse(message);

    expect(actual).toThrow();
  });

  test("データ部を正しく解析できる", () => {
    const message = Buffer.from(
      "10810fa502880105ff017203800130880200428900",
      "hex",
    );
    const data = EchonetData.parse(message);

    expect(data.properties).toEqual([
      {
        epc: 0x80,
        pdc: 1,
        edt: 0x30n,
      },
      {
        epc: 0x88,
        pdc: 2,
        edt: 0x0042n,
      },
      {
        epc: 0x89,
        pdc: 0,
        edt: 0x0000n,
      },
    ]);
  });
});

describe("getEdt", () => {
  test("存在しないepcを指定すると例外をスローする", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [{ epc: 0x10, edt: 0x01 }],
    });

    const actual = () => data.getEdt(0xff);

    expect(actual).toThrow();
  });

  test("7バイト以上のデータを指定すると例外をスローする", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [{ epc: 0x10, edt: 0xffffffffffffffn }],
    });

    const actual = () => data.getEdt(0x10);

    expect(actual).toThrow();
  });

  test("6バイト以下のデータをnumberで取得できる", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [{ epc: 0x10, edt: 0xffffffffffff }],
    });

    const edt = data.getEdt(0x10);

    expect(edt).toBe(0xffffffffffff);
  });
});

describe("getEdtAsBigInt", () => {
  test("存在しないepcを指定すると例外をスローする", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [{ epc: 0x10, edt: 0x01 }],
    });

    const actual = () => data.getEdtAsBigInt(0xff);

    expect(actual).toThrow();
  });

  test("7バイト以上のデータをbigintで取得できる", () => {
    const data = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [{ epc: 0x10, edt: 0xffffffffffffffn }],
    });

    const edt = data.getEdtAsBigInt(0x10);

    expect(edt).toBe(0xffffffffffffffn);
  });
});

describe("isValidResponse", () => {
  test("自身のリクエストに対するレスポンスである場合true", () => {
    const reqData = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [],
    });

    const resData = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x72,
      tid: 0x99,
      properties: [],
    });

    const actual = reqData.isValidResponse(resData);

    expect(actual).toBe(true);
  });

  test("自身のリクエストに対するレスポンスでない場合false", () => {
    const reqData = EchonetData.create({
      seoj: 0x05ff01,
      deoj: 0x028801,
      esv: 0x62,
      tid: 0x99,
      properties: [],
    });

    const resData = EchonetData.create({
      seoj: 0x028801,
      deoj: 0x05ff01,
      esv: 0x72,
      tid: 0xff,
      properties: [],
    });

    const actual = reqData.isValidResponse(resData);

    expect(actual).toBe(false);
  });
});

describe("toBuffer", () => {
  test("正しいBufferを取得できる", () => {
    const message = Buffer.from(
      "10810fa502880105ff017207800130880142e7040000016ee804001e000ae0040004f3c1e3040000000bff00",
      "hex",
    );
    const data = EchonetData.parse(message);

    const actual = data.toBuffer();

    expect(actual).toEqual(message);
  });
});

describe("toString", () => {
  test("解析しやすい文字列に変換できる", () => {
    const message = Buffer.from("10810fa502880105ff017202800130880142", "hex");
    const data = EchonetData.parse(message);

    const actual = data.toString();

    expect(actual).toEqual(
      "tid=0x0fa5 | seoj=0x028801 | deoj=0x05ff01 | esv=0x72 | properties=[epc=0x80, pdc=1, edt=0x30 | epc=0x88, pdc=1, edt=0x42] | all=0x10810fa502880105ff017202800130880142",
    );
  });
});
