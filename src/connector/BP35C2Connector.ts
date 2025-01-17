import { PanInfo, WiSunConnector } from "@/connector/WiSunConnector";
import logger from "@/logger";
import { ReadlineParser } from "@serialport/parser-readline";
import { pEvent, TimeoutError } from "p-event";
import { DelimiterParser, SerialPort } from "serialport";
import { Emitter } from "strict-event-emitter";
import { setTimeout } from "timers/promises";

const BAUDRATE = 115200;
const SCAN_DURATION = 6; // スキャンのデフォルト期間
const SCAN_TIMEOUT = 30000; // スキャンのタイムアウト (ms)
const JOIN_TIMEOUT = 30000; // ジョインのタイムアウト (ms)
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

type Events = {
  message: [message: Buffer]; // スマートメーターからのEchonet Liteメッセージ
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
    this.parser = this.serialPort.pipe(
      new DelimiterParser({ delimiter: Buffer.from(CRLF, "utf-8") }),
    );

    // シリアルポートからのデータ受信
    this.parser.on("data", (data: Buffer) => {
      const textData = data.toString("utf8");
      const firstSpaceIndex = textData.indexOf(" ");
      const command =
        firstSpaceIndex === -1 ? textData : textData.slice(0, firstSpaceIndex);

      if (command !== "ERXUDP") {
        // ERXUDP 以外は全体を文字列として扱う
        logger.debug(`SerialPort response: ${textData}`);
        return;
      }

      // ERXUDP の場合、データ長い部分を抽出
      const byteLengthStartIndex = 118;
      const byteLengthEndIndex = byteLengthStartIndex + 4;
      const lengthString = textData.substring(
        byteLengthStartIndex,
        byteLengthEndIndex,
      );
      const dataLength = parseInt(lengthString, 16);
      if (isNaN(dataLength) || dataLength < 0) {
        console.error("Invalid data length in ERXUDP message:", lengthString);
        return;
      }

      // バイナリデータを切り出し
      const binaryDataStartIndex = byteLengthEndIndex + 1;
      const message = data.subarray(
        binaryDataStartIndex,
        binaryDataStartIndex + dataLength,
      );
      logger.debug(
        `SerialPort response: ${textData.substring(0, binaryDataStartIndex)}<HEX:${message.toString("hex")}>`,
      );

      // ECHONET Liteメッセージならイベントを発火
      if (message.readUInt16BE(0) === 0x1081) {
        this.emit("message", message);
      }
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
   * @param expected 期待する応答テスト関数
   * @param timeout コマンドのタイムアウト時間（ミリ秒）
   * @returns コマンドの応答を配列で返します。
   */
  async sendCommand(
    command: string | Buffer,
    expected: (data: string) => boolean = (data) => data.startsWith("OK"),
    timeout: number = COMMAND_TIMEOUT,
  ): Promise<string[]> {
    let sendCommand, logCommand;
    if (typeof command === "string") {
      sendCommand = command + CRLF;
      logCommand = command + "<CRLF>";
    } else {
      sendCommand = command;
      logCommand = sendCommand.toString("utf-8");
    }
    logger.debug(`Sending command: ${logCommand}`);

    // データ受信待機の開始（送信前）
    const responses: string[] = [];
    const dataPromise = pEvent(this.parser, "data", {
      timeout,
      filter: (data: Buffer) => {
        const textData = data.toString("utf8");
        responses.push(textData);

        if (expected(textData)) {
          return true; // 条件に一致したら解決
        } else if (textData.startsWith("FAIL")) {
          const errorCode = textData.substring(5);
          const errorMessage = ErrorMessages.get(errorCode) ?? "Unknown";
          throw new Error(`[${errorCode}] ${errorMessage}`);
        }

        return false;
      },
    });

    // コマンドを送信
    await new Promise<void>((resolve, reject) => {
      this.serialPort.write(sendCommand, (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });

    // データの受信を待機
    try {
      await dataPromise;
    } catch (err) {
      if (err instanceof TimeoutError) {
        throw new Error(`Command "${logCommand}" timed out after ${timeout}ms`);
      }
      throw err;
    }

    return responses;
  }

  /** @inheritdoc */
  async sendEchonetLite(data: Buffer): Promise<void> {
    if (!this.ipv6Address) {
      throw new Error("Not connected to the device.");
    }

    logger.debug(`Request message: ${data.toString("hex")}`);
    const hexDataLength = data.length
      .toString(16)
      .toUpperCase()
      .padStart(4, "0");
    const commandBuffer = Buffer.from(
      `SKSENDTO 1 ${this.ipv6Address} ${HEX_PORT} 1 0 ${hexDataLength} `,
      "utf8",
    );

    await this.sendCommand(Buffer.concat([commandBuffer, data]));
  }

  /** @inheritdoc */
  async setAuth(id: string, password: string): Promise<void> {
    logger.info("Setting authentication credentials...");
    await this.sendCommand(`SKSETRBID ${id}`);
    await this.sendCommand(`SKSETPWD C ${password}`);
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
    await this.sendCommand(`SKSREG S2 ${panInfo["Channel"]}`);
    await this.sendCommand(`SKSREG S3 ${panInfo["Pan ID"]}`);
    const [, ipv6Address] = await this.sendCommand(
      `SKLL64 ${panInfo["Addr"]}`,
      (data) => !data.startsWith("SKLL64"),
    );
    const responses = await this.sendCommand(
      `SKJOIN ${ipv6Address}`,
      (data) => /^EVENT (24|25)/.test(data),
      JOIN_TIMEOUT,
    );
    const event = responses[responses.length - 1];
    if (!event.startsWith("EVENT 25")) {
      throw new Error(`Connection failed: ${event}`);
    }

    this.ipv6Address = ipv6Address;
  }

  private async scanInternal(): Promise<PanInfo | undefined> {
    logger.info("Starting PAN scan...");
    const [, , ...responses] = await this.sendCommand(
      `SKSCAN 2 FFFFFFFF ${SCAN_DURATION} 0`,
      (data) => data.startsWith("EVENT 22"),
      SCAN_TIMEOUT,
    );

    const panInfo: PanInfo = {};
    responses.forEach((res) => {
      if (!res.startsWith("  ")) return;
      const separatorIndex = res.indexOf(":");
      if (separatorIndex === -1) return;
      const key = res.substring(2, separatorIndex);
      const value = res.substring(separatorIndex + 1);
      panInfo[key] = value;
    });
    if (Object.values(panInfo).length === 0) {
      return undefined;
    }

    logger.info("PAN scan completed successfully");
    return panInfo;
  }

  /** @inheritdoc */
  async scan(
    maxRetries: number,
    retryInterval: number = 1000,
  ): Promise<PanInfo> {
    let retries = 0;
    let panInfo: PanInfo | undefined = undefined;
    while ((panInfo = await this.scanInternal()) === undefined) {
      retries++;
      if (retries >= maxRetries) {
        logger.error(`Scan failed after ${maxRetries} retries`);
        throw new Error("Wi-SUN scan failed");
      }

      // スキャン失敗時のリトライ処理
      logger.warn(`Scan attempt ${retries}/${maxRetries} failed. Retrying...`);
      await setTimeout(retryInterval);
    }

    return panInfo;
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
