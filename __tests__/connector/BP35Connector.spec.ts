import { BP35Connector } from "@/connector/BP35Connector";
import { PanInfo, WiSunConnector } from "@/connector/WiSunConnector";
import env from "@/env";
import logger from "@/logger";
import { MockBinding, MockPortBinding } from "@serialport/binding-mock";
import { SerialPortStream } from "@serialport/stream";
import assert from "assert";
import * as serialport from "serialport";

jest.mock("serialport", () => {
  const actual = jest.requireActual<typeof serialport>("serialport");
  return {
    ...actual,
    SerialPort: jest
      .fn()
      .mockImplementation(
        ({
          path,
          baudRate,
        }: ConstructorParameters<typeof serialport.SerialPort>[0]) => {
          return new SerialPortStream({
            binding: MockBinding,
            path,
            baudRate,
          });
        },
      ),
  };
});

const mockPanInfo: PanInfo = {
  Channel: "00",
  "Channel Page": "00",
  "Pan ID": "FFFF",
  Addr: "0000111122223333",
  LQI: "FF",
  Side: "0",
  PairID: "00001234",
};

function createConnector(suportSide = true) {
  const devicePath = "/dev/test";
  MockBinding.createPort(devicePath, { echo: true, record: true });
  const connector = new BP35Connector(
    devicePath,
    suportSide ? 0 : undefined,
  ) as unknown as WiSunConnector & {
    serialPort: serialport.SerialPort;
    parser: serialport.ReadlineParser;
    scanInternal: () => Promise<PanInfo | undefined>;
    ipv6Address: string;
    sendCommand: (
      command: string | Buffer,
      expected?: (data: string) => boolean,
      timeout?: number,
    ) => Promise<string[]>;
  };
  return connector;
}

function emitText(mockPort: serialport.SerialPort, text: string) {
  assert(mockPort.port instanceof MockPortBinding);
  mockPort.port.emitData(Buffer.from(`${text}\r\n`, "utf8"));
}

function emitBuffer(mockPort: serialport.SerialPort, buffer: Buffer) {
  assert(mockPort.port instanceof MockPortBinding);
  mockPort.port.emitData(buffer);
}

describe("setAuth", () => {
  test("正しいコマンドを送信している", async () => {
    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;

    const commands: string[] = [];
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      assert(mockPort.port instanceof MockPortBinding);

      if (command.match(/^(SKSETRBID|SKSETPWD)/)) {
        commands.push(command);
        emitText(mockPort, "OK");
      }
    });

    await connector.setAuth(env.ROUTE_B_ID, env.ROUTE_B_PASSWORD);

    expect(commands).toEqual(["SKSETRBID id", "SKSETPWD C password"]);
  });
});

describe("join", () => {
  const initJoin = (
    connector: ReturnType<typeof createConnector>,
    event: string,
  ): string[] => {
    const commands: string[] = [];

    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");

      if (command.match(/^SKSREG/)) {
        commands.push(command);
        emitText(mockPort, "OK");
      } else if (command.match(/^SKLL64/)) {
        commands.push(command);
        emitText(mockPort, "0000:0000:0000:0200:1111:2222:3333");
      } else if (command.match(/^SKJOIN/)) {
        commands.push(command);
        emitText(mockPort, "EVENT 21 xxxx");
        emitText(mockPort, "ERXUDP xxxx");
        emitText(mockPort, `EVENT ${event} xxxx`);
      }
    });

    return commands;
  };

  test("正しいコマンドを送信している", async () => {
    const connector = createConnector();
    const commands = initJoin(connector, "25");

    await connector.join(mockPanInfo);

    expect(commands).toEqual([
      "SKSREG S2 00",
      "SKSREG S3 FFFF",
      "SKLL64 0000111122223333",
      "SKJOIN 0000:0000:0000:0200:1111:2222:3333",
    ]);
  });

  test("EVENT24を受信した場合は例外をスローする", async () => {
    const connector = createConnector();
    initJoin(connector, "24");

    const actual = () => connector.join(mockPanInfo);

    await expect(actual).rejects.toThrow();
  });
});

describe("scan", () => {
  const initScan = (
    connector: ReturnType<typeof createConnector>,
    ...result: boolean[]
  ): string[] => {
    const commands: string[] = [];

    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");

      if (command.match(/^SKSCAN/)) {
        commands.push(command);
        emitText(mockPort, "OK");
        emitText(mockPort, "EPANDESC");
        if (result.shift()) {
          for (const [key, value] of Object.entries(mockPanInfo)) {
            emitText(mockPort, `  ${key}:${value}`);
          }
        }
        emitText(mockPort, "EVENT 22 xxxx");
      }
    });

    return commands;
  };

  test("[scanInternal] 正しいコマンドを送信している", async () => {
    const connector = createConnector();
    const commands = initScan(connector, true);
    await connector.scanInternal();

    expect(commands).toEqual(["SKSCAN 2 FFFFFFFF 6 0"]);
  });

  test("[scanInternal] sideが指定されていない場合追加引数が設定されない", async () => {
    const connector = createConnector(false);
    const commands = initScan(connector, true);
    await connector.scanInternal();

    expect(commands).toEqual(["SKSCAN 2 FFFFFFFF 6"]);
  });

  test("[scanInternal] スキャン結果があった場合はPan情報を返す", async () => {
    const connector = createConnector();
    initScan(connector, true);
    const resultPanInfo = await connector.scanInternal();

    expect(resultPanInfo).toEqual(mockPanInfo);
  });

  test("[scanInternal] スキャン結果がなかった場合はundefinedを返す", async () => {
    const connector = createConnector();
    initScan(connector, false);
    const resultPanInfo = await connector.scanInternal();

    expect(resultPanInfo).toBe(undefined);
  });

  test("[scan] リトライ回数までにスキャンに成功した場合Pan情報を返す", async () => {
    const connector = createConnector();
    initScan(connector, false, true);
    const resultPanInfo = await connector.scan(3);

    expect(resultPanInfo).toEqual(mockPanInfo);
  });

  test("[scan] リトライ回数までにスキャンに成功しなかった場合例外をスローする", async () => {
    const connector = createConnector();
    initScan(connector);
    const actual = connector.scan(3);

    await expect(actual).rejects.toThrow("Wi-SUN scan failed");
  });
});

describe("close", () => {
  test("正常終了する", async () => {
    const connector = createConnector();
    const { serialPort: mockPort } = connector;

    await new Promise((resolve) => mockPort.on("open", resolve));

    const closeSpy = jest.fn();
    mockPort.on("close", closeSpy);

    await connector.close();

    expect(closeSpy).toHaveBeenCalled();
  });

  test("close処理でエラーが発生しても正常終了する", async () => {
    const connector = createConnector();
    const { serialPort: mockPort } = connector;

    await new Promise((resolve) => mockPort.on("open", resolve));

    mockPort.close = (callback) => {
      assert(callback);
      callback(new Error());
    };

    const actual = connector.close();

    await expect(actual).resolves.not.toThrow();
  });
});

describe("sendEchonetLite", () => {
  const initSendEchonetLite = (
    connector: ReturnType<typeof createConnector>,
  ): Buffer[] => {
    const commands: Buffer[] = [];

    const { serialPort: mockPort, parser: mockParser } = connector;

    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");

      if (command.match(/^SKSENDTO/)) {
        commands.push(data);
        emitText(mockPort, "EVENT 21 xxxx");
        emitText(mockPort, "OK");
      }
    });

    return commands;
  };

  test("正常終了する", async () => {
    const connector = createConnector();
    const { serialPort: mockPort } = connector;

    connector.ipv6Address = "0000:0000:0000:0200:1111:2222:3333";
    const commands = initSendEchonetLite(connector);

    const data = Buffer.from(
      "1081725a05ff010288016206800100880100e70100e80100e00100e30100",
      "hex",
    );
    const sendPromise = connector.sendEchonetLite(data);
    // SKSENDTOはCRLFを送信しないが、実機ではエコーバックに含まれる
    setImmediate(() => emitText(mockPort, ""));
    await sendPromise;

    expect(commands).toEqual([
      Buffer.concat([
        Buffer.from(
          "SKSENDTO 1 0000:0000:0000:0200:1111:2222:3333 0E1A 1 0 001E ",
          "utf-8",
        ),
        data,
      ]),
    ]);
  });

  test("IPv6アドレスが設定されていない場合例外をすろーする", async () => {
    const connector = createConnector();

    const actual = connector.sendEchonetLite(Buffer.alloc(0));

    await expect(actual).rejects.toThrow();
  });

  test("sideが指定されていない場合追加引数が設定されない", async () => {
    const connector = createConnector(false);
    const { serialPort: mockPort } = connector;

    connector.ipv6Address = "0000:0000:0000:0200:1111:2222:3333";
    const commands = initSendEchonetLite(connector);

    const data = Buffer.from(
      "1081725a05ff010288016206800100880100e70100e80100e00100e30100",
      "hex",
    );
    const sendPromise = connector.sendEchonetLite(data);
    // SKSENDTOはCRLFを送信しないが、実機ではエコーバックに含まれる
    setImmediate(() => emitText(mockPort, ""));
    await sendPromise;

    expect(commands).toEqual([
      Buffer.concat([
        Buffer.from(
          "SKSENDTO 1 0000:0000:0000:0200:1111:2222:3333 0E1A 1 001E ",
          "utf-8",
        ),
        data,
      ]),
    ]);
  });
});

describe("setupSerialEventHandlers", () => {
  test("引数なしのテキストコマンドをデバッグログ出力する", async () => {
    const logDebugSpy = jest.spyOn(logger, "debug");

    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKTEST/)) {
        emitText(mockPort, "OK");
      }
    });

    await connector.sendCommand("SKTEST");

    expect(logDebugSpy).toHaveBeenCalledWith(
      "Received TEXT data from SerialPort: SKTEST",
    );
  });

  test("引数ありのテキストコマンドをデバッグログ出力する", async () => {
    const logDebugSpy = jest.spyOn(logger, "debug");

    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKTEST/)) {
        emitText(mockPort, "OK");
      }
    });

    await connector.sendCommand("SKTEST 1 2 3");

    expect(logDebugSpy).toHaveBeenCalledWith(
      "Received TEXT data from SerialPort: SKTEST 1 2 3",
    );
  });

  test("不正なERXUDPを受け取った場合エラーログを出力", async () => {
    const logErrorSpy = jest.spyOn(logger, "error");

    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKSENDTO/)) {
        emitText(mockPort, "ERXUDP unknown");
      }
    });

    await connector.sendCommand("SKSENDTO xxxx", (data) =>
      data.startsWith("ERXUDP"),
    );

    expect(logErrorSpy).toHaveBeenCalledWith(
      "Invalid ERXUDP message format received from SerialPort: ERXUDP unknown",
    );
  });

  test("3610ポート以外のメッセージを受け取った場合ログを出力", async () => {
    const logInfoSpy = jest.spyOn(logger, "info");

    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKSENDTO/)) {
        emitText(
          mockPort,
          "ERXUDP FE80:0000:0000:0000:0000:0000:0000:0000 FE80:0000:0000:0000:0000:0000:0000:0000 02CC 02CC 0000111122223333 0 0 0001  ",
        );
      }
    });

    await connector.sendCommand("SKSENDTO xxxx", (data) =>
      data.startsWith("ERXUDP"),
    );

    expect(logInfoSpy).toHaveBeenCalledWith(
      "Received data does not match ECHONET Lite format.",
    );
  });

  test("ヘッダが0x1081以外のメッセージを受け取った場合ログを出力", async () => {
    const logInfoSpy = jest.spyOn(logger, "info");

    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKSENDTO/)) {
        emitText(
          mockPort,
          "ERXUDP FE80:0000:0000:0000:0000:0000:0000:0000 FE80:0000:0000:0000:0000:0000:0000:0000 0E1A 0E1A 0000111122223333 0 0 0002   ",
        );
      }
    });

    await connector.sendCommand("SKSENDTO xxxx", (data) =>
      data.startsWith("ERXUDP"),
    );

    expect(logInfoSpy).toHaveBeenCalledWith(
      "Received data does not match ECHONET Lite format.",
    );
  });

  test("ECHONET Liteメッセージを受け取ったときイベント通知", async () => {
    const mockMessage = Buffer.from(
      "108106e102880105ff017206800130880142e70400000698e80400a00028e0040004f3fde3040000000b",
      "hex",
    );

    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;

    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKSENDTO/)) {
        // sideあり
        emitBuffer(
          mockPort,
          Buffer.concat([
            Buffer.from(
              "ERXUDP FE80:0000:0000:0000:0000:0000:0000:0000 FE80:0000:0000:0000:0000:0000:0000:0000 0E1A 0E1A 0000111122223333 0 0 002A ",
              "utf8",
            ),
            mockMessage,
            Buffer.from("\r\n", "utf-8"),
          ]),
        );
        // sideなし
        emitBuffer(
          mockPort,
          Buffer.concat([
            Buffer.from(
              "ERXUDP FE80:0000:0000:0000:0000:0000:0000:0000 FE80:0000:0000:0000:0000:0000:0000:0000 0E1A 0E1A 0000111122223333 0 002A ",
              "utf8",
            ),
            mockMessage,
            Buffer.from("\r\n", "utf-8"),
          ]),
        );
        emitText(mockPort, "TESTEND");
      }
    });

    const messageSpy = jest.fn();
    connector.on("message", messageSpy);

    const sendPromise = connector.sendCommand("SKSENDTO xxxx", (data) =>
      data.startsWith("TESTEND"),
    );
    setImmediate(() => emitText(mockPort, ""));
    await sendPromise;

    expect(messageSpy).toHaveBeenNthCalledWith(1, mockMessage);
    expect(messageSpy).toHaveBeenNthCalledWith(2, mockMessage);
  });

  test("シリアル通信でエラーが発生したときエラーログに出力する", () => {
    const logErrorSpy = jest.spyOn(logger, "error");

    const connector = createConnector();
    const { serialPort: mockPort } = connector;

    mockPort.emit("error", new Error("test error"));

    expect(logErrorSpy).toHaveBeenCalledWith(
      "An error occurred in the SerialPort:",
      expect.any(Error),
    );
  });
});

describe("sendCommand", () => {
  test("expectedの指定がない場合、OKが返ってくるとPromiseを解決する", async () => {
    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKTEST/)) {
        emitText(mockPort, "OK");
      }
    });

    const actual = connector.sendCommand("SKTEST");

    await expect(actual).resolves.not.toThrow();
  });

  test("FAILで想定内のエラーコードが返ってくると、メッセージを付与して例外をスローする", async () => {
    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKTEST/)) {
        emitText(mockPort, "FAIL ER04");
      }
    });

    const actual = connector.sendCommand("SKTEST");

    await expect(actual).rejects.toThrow(
      "[ER04] 指定されたコマンドがサポートされていない",
    );
  });

  test("FAILで想定外のエラーコードが返ってくると、メッセージを付与せず例外をスローする", async () => {
    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKTEST/)) {
        emitText(mockPort, "FAIL UNKNOWN");
      }
    });

    const actual = connector.sendCommand("SKTEST");

    await expect(actual).rejects.toThrow("FAIL UNKNOWN");
  });

  test("expectedの条件を満たすまでのレスポンスを受け取れる", async () => {
    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKTEST/)) {
        emitText(mockPort, "FOO");
        emitText(mockPort, "BAR");
        emitText(mockPort, "OK");
      }
    });

    const actual = await connector.sendCommand("SKTEST");

    // エコーバックを含む
    expect(actual).toEqual(["SKTEST", "FOO", "BAR", "OK"]);
  });

  test("テキストコマンドはCRLFを付与する", async () => {
    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKTEST/)) {
        emitText(mockPort, "OK");
      }
    });

    await connector.sendCommand("SKTEST");

    assert(mockPort.port instanceof MockPortBinding);
    expect(mockPort.port.recording.toString("utf8")).toBe("SKTEST\r\n");
  });

  test("バイナリコマンドはCRLFを付与しない", async () => {
    const connector = createConnector();
    const { serialPort: mockPort, parser: mockParser } = connector;
    mockParser.on("data", (data: Buffer) => {
      const command = data.toString("utf8");
      if (command.match(/^SKTEST/)) {
        emitText(mockPort, "OK");
      }
    });

    try {
      await connector.sendCommand(
        Buffer.from("SKTEST", "utf8"),
        undefined,
        100,
      );
    } catch (_) {
      // エコーバックに改行を含まないためfilterが呼び出されずタイムアウトする
    }

    assert(mockPort.port instanceof MockPortBinding);
    expect(mockPort.port.recording.toString("utf8")).toBe("SKTEST");
  });

  test("write処理でエラーが発生すると例外をスローする", async () => {
    const connector = createConnector();
    const { serialPort: mockPort } = connector;

    await new Promise((resolve) => mockPort.on("open", resolve));

    mockPort.write = (data, callback) => {
      assert(typeof callback === "function");
      callback(new Error("Mock write error")); // 意図的なエラー
      return false;
    };

    const actual = connector.sendCommand("SKTEST", undefined);

    await expect(actual).rejects.toThrow();

    emitText(mockPort, "OK"); // pEventを終了させるため
  });
});
