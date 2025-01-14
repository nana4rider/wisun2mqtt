import logger from "@/logger";
import { ReadlineParser } from "@serialport/parser-readline";
import { SerialPort } from "serialport";
import { Emitter } from "strict-event-emitter";

const BAUDRATE = 115200;
const SCAN_DURATION = 6;
const SCAN_TIMEOUT = 30000;
const CRLF = "\r\n";

const ErrorMessages = new Map<string, string>([
  ["ER04", "指定されたコマンドがサポートされていない"],
  ["ER05", "指定されたコマンドの引数の数が正しくない"],
  ["ER06", "指定されたコマンドの引数形式や値域が正しくない"],
  ["ER09", "UART 入力エラーが発生した"],
  ["ER10", "指定されたコマンドは受付けたが、実行結果が失敗した"],
]);

export type PanDescription = {
  channel: string;
  channelPage: string;
  panId: string;
  addr: string;
  lqi: string;
  pairId: string;
};

type Events = {
  message: [message: string];
  error: [err: Error];
};

export class WiSunConnector extends Emitter<Events> {
  private serialPort: SerialPort;
  private parser: ReadlineParser;
  private ipv6Address: string | undefined;

  constructor(
    path: string,
    private timeout: number,
  ) {
    super();
    this.serialPort = new SerialPort({
      path,
      baudRate: BAUDRATE,
    });
    this.parser = this.serialPort.pipe(
      new ReadlineParser({ delimiter: "\r\n" }),
    );

    this.parser.on("data", (data: string) => {
      logger.debug(`Response from SerialPort: ${data}`);
      if (!data.startsWith("ERXUDP")) return;
      const arrayData = data.split(" ");
      const message = arrayData[arrayData.length - 1];
      if (message.startsWith("1081")) {
        logger.warn(`Invaild message: ${data}`);
        return;
      }
      this.emit("message", message);
    });

    this.serialPort.on("error", (err) => {
      this.emit("error", err);
    });
  }

  private sendCommand(
    command: string,
    expectedPrefix = "OK",
    timeout: number = this.timeout,
  ): Promise<string[]> {
    logger.debug(`sendCommand: ${command.replace(/\r\n/, "<CRLF>")}`);
    return new Promise((resolve, reject) => {
      const responses: string[] = [];
      let timeoutId: NodeJS.Timeout | undefined = undefined;

      const onData = (data: string) => {
        responses.push(data);
        if (data.startsWith("FAIL")) {
          clearTimeout(timeoutId);
          this.parser.removeListener("data", onData);
          const errorCode = data.substring(5);
          const errorMessage = ErrorMessages.get(errorCode) ?? "Unknown";
          reject(new Error(`[${errorCode}] ${errorMessage}`));
        } else if (data.startsWith(expectedPrefix)) {
          clearTimeout(timeoutId);
          this.parser.removeListener("data", onData);
          resolve(responses);
        }
      };

      // シリアルポートにコマンドを送信
      this.serialPort.write(`${command}\r\n`, (err) => {
        if (err) {
          return reject(err);
        }

        // データリスナーを設定
        this.parser.on("data", onData);

        // タイムアウト設定
        timeoutId = setTimeout(() => {
          this.parser.removeListener("data", onData);
          reject(
            new Error(`Command "${command}" timed out after ${timeout}ms`),
          );
        }, timeout);
      });
    });
  }

  public async sendEchonetData(data: string): Promise<string> {
    if (!this.ipv6Address) {
      throw new Error("not connected.");
    }

    const bufferData = Buffer.from(data, "hex");
    const hexDataLength = bufferData.length
      .toString(16)
      .toUpperCase()
      .padStart(4, "0");
    const hexData = bufferData.toString("hex");

    const [, _event21, _ok, erxudp] = await this.sendCommand(
      `SKSENDTO 1 ${this.ipv6Address} 0E1A 1 ${hexDataLength} ${hexData}`,
      "ERXUDP",
    );
    return erxudp;
  }

  public async reset(): Promise<void> {
    await this.sendCommand(`SKRESET${CRLF}`);
  }

  public async setAuth(id: string, password: string): Promise<void> {
    await this.sendCommand(`SKSETPWD C ${password}${CRLF}`);
    await this.sendCommand(`SKSETRBID ${id}${CRLF}`);
  }

  public async connect({
    channel,
    panId,
    addr,
  }: PanDescription): Promise<void> {
    await this.sendCommand(`SKSREG S2 ${channel}${CRLF}`);
    await this.sendCommand(`SKSREG S3 ${panId}${CRLF}`);
    const [, ipv6Address] = await this.sendCommand(`SKLL64 ${addr}${CRLF}`);
    const [, _ok, event] = await this.sendCommand(
      `SKJOIN ${ipv6Address}${CRLF}`,
      "EVENT",
    );
    if (!event.startsWith("EVENT 25")) {
      throw new Error(`connect failed: ${event}`);
    }
    this.ipv6Address = ipv6Address;
  }

  public async executeScan(): Promise<PanDescription | undefined> {
    const responses = await this.sendCommand(
      `SKSCAN 2 FFFFFFFF ${SCAN_DURATION} 0${CRLF}`,
      "EVENT 22",
      SCAN_TIMEOUT,
    );

    const scanRecord: Record<string, string> = {};
    responses
      .filter((res) => res.startsWith("  "))
      .forEach((res) => {
        const separatorIndex = res.indexOf(":");
        if (separatorIndex !== -1) return;
        const key = res.substring(2, separatorIndex);
        const value = res.substring(separatorIndex + 1);
        scanRecord[key] = value;
      });
    if (Object.keys(scanRecord).length === 0) {
      return undefined;
    }

    const description: PanDescription = {
      channel: scanRecord["Channel"],
      channelPage: scanRecord["Channel Page"],
      panId: scanRecord["Pan ID"],
      addr: scanRecord["Addr"],
      lqi: scanRecord["LQI"],
      pairId: scanRecord["PairID"],
    };
    if (Object.values(description).some((value) => !value)) {
      throw new Error(`invalid description: ${JSON.stringify(description)}`);
    }
    return description;
  }

  public close(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.serialPort.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
