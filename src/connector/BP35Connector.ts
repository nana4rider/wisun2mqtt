import type { PanInfo, WiSunConnector } from "@/connector/WiSunConnector";
import logger from "@/logger";
import type { ReadlineParser } from "@serialport/parser-readline";
import assert from "assert";
import { pEvent } from "p-event";
import { DelimiterParser, SerialPort } from "serialport";
import { Emitter } from "strict-event-emitter";

/** ボーレート */
const BAUDRATE = 115200;
/** スキャン間隔 */
const SCAN_DURATION = 6;
/** コマンドのタイムアウト */
const COMMAND_TIMEOUT = 3000;
/** SKSCAN 2のタイムアウト スキャン時間 0.0096 sec * (2^<DURATION> + 1) */
const SCAN_TIMEOUT =
  0.0096 * 2 ** (SCAN_DURATION + 1) * 28 * 1000 + COMMAND_TIMEOUT;
/** SKJOINのタイムアウト */
const JOIN_TIMEOUT = 38000 + COMMAND_TIMEOUT;

const CRLF = "\r\n";
const HEX_ECHONET_PORT = "0E1A"; // 3610

const ErrorMessages = new Map<string, string>([
  // ER01-ER03 Reserved
  ["ER04", "指定されたコマンドがサポートされていない"],
  ["ER05", "指定されたコマンドの引数の数が正しくない"],
  ["ER06", "指定されたコマンドの引数形式や値域が正しくない"],
  // ER07-ER08 Reserved
  ["ER09", "UART 入力エラーが発生した"],
  ["ER10", "指定されたコマンドは受付けたが、実行結果が失敗した"],
]);

type Events = {
  message: [message: Buffer]; // スマートメーターからのEchonet Liteメッセージ
  error: [err: Error]; // エラーイベント
};

export class BP35Connector extends Emitter<Events> implements WiSunConnector {
  private serialPort: SerialPort;
  private parser: ReadlineParser;
  private ipv6Address: string | undefined;
  private panInfo: PanInfo | undefined;
  private extendArg: string;

  /**
   * BP35Connector クラスのインスタンスを初期化します。
   *
   * @param devicePath シリアルポートのパス
   * @param side B面:0 HAN面:1
   * @param
   */
  constructor(devicePath: string, side: 0 | 1 | undefined = undefined) {
    super();

    this.extendArg = side !== undefined ? ` ${side}` : "";
    this.serialPort = new SerialPort({ path: devicePath, baudRate: BAUDRATE });
    this.parser = this.serialPort.pipe(
      new DelimiterParser({ delimiter: Buffer.from(CRLF, "utf-8") }),
    );
    this.setupSerialEventHandlers();
  }

  private setupSerialEventHandlers() {
    // シリアルポートからのデータ受信
    this.parser.on("data", (data: Buffer) => {
      const textData = data.toString("utf8");
      const firstSpaceIndex = textData.indexOf(" ");
      const command =
        firstSpaceIndex === -1 ? textData : textData.slice(0, firstSpaceIndex);

      if (command !== "ERXUDP") {
        // ERXUDP 以外は全体を文字列として扱う
        logger.debug(`Received TEXT data from SerialPort: ${textData}`);
        return;
      }

      const commandMatcher = textData.match(
        /^ERXUDP (?<sender>.{39}) (?<dest>.{39}) (?<rport>.{4}) (?<lport>.{4}) (?<senderlla>.{16}) (?<secured>.) ((?<side>.) )?(?<datalen>[0-9A-F]{4}) /,
      );
      if (!commandMatcher) {
        logger.error(
          `Invalid ERXUDP message format received from SerialPort: ${textData}`,
        );
        return;
      }
      assert(commandMatcher.groups);

      // バイナリデータを切り出し
      const binaryDataStartIndex = commandMatcher[0].length;
      const binaryDataLength = parseInt(commandMatcher.groups.datalen, 16);
      const message = data.subarray(
        binaryDataStartIndex,
        binaryDataStartIndex + binaryDataLength,
      );
      logger.debug(
        `Parsed ERXUDP message: ${commandMatcher[0]}<HEX:${message.toString("hex")}>`,
      );

      // ポートとヘッダを確認
      if (
        commandMatcher.groups.rport !== HEX_ECHONET_PORT ||
        message.readUInt16BE(0) !== 0x1081
      ) {
        logger.info("Received data does not match ECHONET Lite format.");
        return;
      }

      this.emit("message", message);
    });

    // シリアルポートのエラーハンドリング
    this.serialPort.on("error", (err) => {
      logger.error("An error occurred in the SerialPort:", err);
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
        return expected(textData) || textData.startsWith("FAIL");
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
    await dataPromise;

    // エラーを受信していた場合は例外をスロー
    const lastResponse = responses[responses.length - 1];
    if (lastResponse.startsWith("FAIL")) {
      const errorCode = lastResponse.substring(5);
      const errorMessage = ErrorMessages.get(errorCode);
      throw new Error(
        errorMessage ? `[${errorCode}] ${errorMessage}` : lastResponse,
      );
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
      `SKSENDTO 1 ${this.ipv6Address} ${HEX_ECHONET_PORT} 1${this.extendArg} ${hexDataLength} `,
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
    await this.sendCommand(`SKSREG S2 ${panInfo.Channel}`);
    await this.sendCommand(`SKSREG S3 ${panInfo["Pan ID"]}`);
    const [_echo, ipv6Address] = await this.sendCommand(
      `SKLL64 ${panInfo.Addr}`,
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
    this.panInfo = panInfo;
  }

  private async scanInternal(): Promise<PanInfo | undefined> {
    logger.info("Starting PAN scan...");
    const [_echo, _ok, ...responses] = await this.sendCommand(
      `SKSCAN 2 FFFFFFFF ${SCAN_DURATION}${this.extendArg}`,
      (data) => data.startsWith("EVENT 22"),
      SCAN_TIMEOUT,
    );

    const panInfo: Record<string, string> = {};
    responses.forEach((res) => {
      const paninfoMatcher = res.match(
        /^ {2}(?<key>[a-zA-Z ]+):(?<value>[A-Z0-9]+)/,
      );
      if (!paninfoMatcher) return;
      assert(paninfoMatcher.groups);
      panInfo[paninfoMatcher.groups.key] = paninfoMatcher.groups.value;
    });
    if (Object.values(panInfo).length === 0) {
      return undefined;
    }

    logger.info("PAN scan completed successfully");
    return panInfo as PanInfo;
  }

  /** @inheritdoc */
  async scan(maxRetries: number): Promise<PanInfo> {
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
    }

    return panInfo;
  }

  /** @inheritdoc */
  getPanInfo(): PanInfo {
    if (!this.panInfo) {
      throw new Error("Not connected to the device.");
    }
    return this.panInfo;
  }

  /** @inheritdoc */
  close(): Promise<void> {
    logger.info("Closing serial port...");
    return new Promise<void>((resolve) => {
      this.serialPort.close((err) => {
        if (err) {
          logger.error("Failed to close serial port:", err);
        } else {
          logger.info("Serial port successfully closed");
        }
        resolve();
      });
    });
  }
}
