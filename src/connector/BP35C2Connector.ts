import { WiSunConnector } from "@/connector/WiSunConnector";
import logger from "@/logger";
import { ReadlineParser } from "@serialport/parser-readline";
import { SerialPort } from "serialport";
import { Emitter } from "strict-event-emitter";
import { setTimeout as promiseSetTimeout } from "timers/promises";

const BAUDRATE = 115200;
const SCAN_DURATION = 6; // スキャンのデフォルト期間
const SCAN_TIMEOUT = 30000; // スキャンのタイムアウト (ms)
const COMMAND_TIMEOUT = 5000; // スキャンを除くコマンドのタイムアウト
const CRLF = "\r\n";
const HEX_PORT = "0E1A"; // 3610

const ErrorMessages = new Map<string, string>([
  ["ER04", "指定されたコマンドがサポートされていない"],
  ["ER05", "指定されたコマンドの引数の数が正しくない"],
  ["ER06", "指定されたコマンドの引数形式や値域が正しくない"],
  ["ER09", "UART 入力エラーが発生した"],
  ["ER10", "指定されたコマンドは受付けたが、実行結果が失敗した"],
]);

export type PanInfo = {
  [name in string]: string;
};

type Events = {
  message: [message: Buffer]; // スマートメーターからのメッセージ
  error: [err: Error]; // エラーイベント
};

/**
 * https://www.furutaka-netsel.co.jp/maker/rohm/bp35c2
 */
export class BP35C2Connector extends Emitter<Events> implements WiSunConnector {
  private serialPort: SerialPort;
  private parser: ReadlineParser;
  private ipv6Address: string | undefined;

  /**
   * BP35C2Connector クラスのインスタンスを初期化します。
   *
   * @param device シリアルポートのパス
   */
  constructor(device: string) {
    super();
    this.serialPort = new SerialPort({ path: device, baudRate: BAUDRATE });
    this.parser = this.serialPort.pipe(new ReadlineParser({ delimiter: CRLF }));

    // シリアルポートからのデータ受信
    this.parser.on("data", (data: string) => {
      logger.debug(`SerialPort response: ${data}`);
      if (!data.startsWith("ERXUDP")) return;

      const arrayErxudp = data.split(" ");
      const responseHexString = arrayErxudp[arrayErxudp.length - 1];

      // ECHONET Liteメッセージを検証
      if (!responseHexString.startsWith("1081")) {
        logger.warn(`Invalid ECHONET Lite message: ${data}`);
        return;
      }

      this.emit("message", Buffer.from(responseHexString, "hex"));
    });

    // シリアルポートのエラーハンドリング
    this.serialPort.on("error", (err) => {
      logger.error("SerialPort error:", err);
      this.emit("error", err);
    });
  }

  /**
   * シリアルコマンドを送信し、応答を取得します。
   *
   * @param command 送信するコマンド
   * @param expectedPrefix 期待する応答のプレフィックス
   * @param timeout コマンドのタイムアウト時間（ミリ秒）
   * @returns コマンドの応答を配列で返します。
   */
  sendCommand(
    command: string,
    expectedPrefix = "OK",
    timeout: number = COMMAND_TIMEOUT,
  ): Promise<string[]> {
    logger.debug(`Sending command: ${command.replace(CRLF, "<CRLF>")}`);
    return new Promise((resolve, reject) => {
      const responses: string[] = [];
      let timeoutId: NodeJS.Timeout | undefined = undefined;

      const onData = (data: string) => {
        responses.push(data);

        // エラーレスポンスを処理
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

      // コマンドを送信
      this.serialPort.write(command, (err) => {
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

  /** @inheritdoc */
  async sendEchonetLite(data: Buffer): Promise<Buffer> {
    if (!this.ipv6Address) {
      throw new Error("Not connected to the device.");
    }

    const hexDataLength = data.length
      .toString(16)
      .toUpperCase()
      .padStart(4, "0");
    const requestHexString = data.toString("hex");

    const [, , , erxudp] = await this.sendCommand(
      `SKSENDTO 1 ${this.ipv6Address} ${HEX_PORT} 1 ${hexDataLength} ${requestHexString}`,
      "ERXUDP",
    );
    const arrayErxudp = erxudp.split(" ");
    const responseHexString = arrayErxudp[arrayErxudp.length - 1];

    return Buffer.from(responseHexString, "hex");
  }

  /** @inheritdoc */
  async reset(): Promise<void> {
    logger.info("Resetting Wi-SUN module...");
    await this.sendCommand(`SKRESET${CRLF}`);
  }

  /** @inheritdoc */
  async setAuth(id: string, password: string): Promise<void> {
    logger.info("Setting authentication credentials...");
    await this.sendCommand(`SKSETPWD C ${password}${CRLF}`);
    await this.sendCommand(`SKSETRBID ${id}${CRLF}`);
  }

  /**
   * PAN の説明を使用して Wi-SUN ネットワークに接続します。
   *
   * @param panInfo PAN情報
   * @returns 接続が確立されたときに解決されるPromise
   * @throws 接続に失敗した場合や予期しないイベントが発生した場合
   */
  async join(panInfo: PanInfo): Promise<void> {
    logger.info("Configuring Wi-SUN connection...");
    await this.sendCommand(`SKSREG S2 ${panInfo["Channel"]}${CRLF}`);
    await this.sendCommand(`SKSREG S3 ${panInfo["Pan ID"]}${CRLF}`);
    const [, ipv6Address] = await this.sendCommand(
      `SKLL64 ${panInfo["Addr"]}${CRLF}`,
    );
    const [, , event] = await this.sendCommand(
      `SKJOIN ${ipv6Address}${CRLF}`,
      "EVENT",
    );
    if (!event.startsWith("EVENT 25")) {
      throw new Error(`Connection failed: ${event}`);
    }
    this.ipv6Address = ipv6Address;
  }

  /**
   * PAN スキャンを実行し、利用可能なネットワークを検索します。
   *
   * @returns ネットワークが見つかった場合はその PAN 情報、見つからなかった場合はundefined
   * @throws スキャンが失敗した場合
   */
  async scan(): Promise<PanInfo | undefined> {
    logger.info("Starting PAN scan...");
    const [, , ...responses] = await this.sendCommand(
      `SKSCAN 2 FFFFFFFF ${SCAN_DURATION} 0${CRLF}`,
      "EVENT 22",
      SCAN_TIMEOUT,
    );

    const panInfo: PanInfo = {};
    responses.forEach((res) => {
      if (!res.startsWith("  ")) return;
      const separatorIndex = res.indexOf(":");
      if (separatorIndex !== -1) return;
      const key = res.substring(2, separatorIndex);
      const value = res.substring(separatorIndex + 1);
      panInfo[key] = value;
    });
    if (Object.values(panInfo).length === 0) {
      throw new Error(`Invalid PAN information: ${JSON.stringify(panInfo)}`);
    }

    logger.info("PAN scan completed successfully");
    return panInfo;
  }

  /** @inheritdoc */
  async scanAndJoin(
    maxRetries: number,
    retryInterval: number = 1000,
  ): Promise<void> {
    let retries = 0;
    let description: PanInfo | undefined = undefined;
    while ((description = await this.scan()) === undefined) {
      retries++;
      if (retries >= maxRetries) {
        logger.error(`Scan failed after ${maxRetries} retries`);
        throw new Error("Wi-SUN scan failed");
      }

      // スキャン失敗時のリトライ処理
      logger.warn(`Scan attempt ${retries}/${maxRetries} failed. Retrying...`);
      await promiseSetTimeout(retryInterval);
    }

    logger.info("Connecting to the device");
    await this.join(description);
  }

  /** @inheritdoc */
  close(): Promise<void> {
    logger.info("Closing serial port...");
    return new Promise<void>((resolve, reject) => {
      this.serialPort.close((err) => {
        if (err) {
          logger.error("Failed to close serial port:", err);
          reject(err);
        } else {
          logger.info("Serial port successfully closed");
          resolve();
        }
      });
    });
  }
}
