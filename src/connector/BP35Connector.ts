import {
  isPanInfo,
  type PanInfo,
  type WiSunConnector,
} from "@/connector/WiSunConnector";
import { EchonetData } from "@/echonet/EchonetData";
import logger from "@/logger";
import { autoDetect } from "@serialport/bindings-cpp";
import type { BindingInterface } from "@serialport/bindings-interface";
import type { ReadlineParser } from "@serialport/parser-readline";
import { SerialPortStream } from "@serialport/stream";
import assert from "assert";
import { pEvent } from "p-event";
import { DelimiterParser } from "serialport";
import { Emitter } from "strict-event-emitter";

/** ボーレート */
const BAUDRATE = 115200;
/** スキャン間隔 */
const SCAN_DURATION = 6;
/** コマンドのタイムアウト */
const DEFAULT_COMMAND_TIMEOUT = 3000;
/** SKSCAN 2のタイムアウト スキャン時間 0.0096 sec * (2^<DURATION> + 1) */
const SCAN_TIMEOUT =
  0.0096 * 2 ** (SCAN_DURATION + 1) * 28 * 1000 + DEFAULT_COMMAND_TIMEOUT;
/** SKJOINのタイムアウト */
const JOIN_TIMEOUT = 38000 + DEFAULT_COMMAND_TIMEOUT;
/** ECHONET Lite ポート番号 */
const ECHONET_PORT = 3610;
/** CRLF */
const CRLF = "\r\n";
/** CRLF Buffer */
const CRLF_BUFFER = Buffer.from(CRLF, "ascii");

type Events = {
  message: [message: EchonetData]; // スマートメーターからのEchonet Liteメッセージ
  error: [err: Error]; // エラーイベント
};

export class BP35Connector extends Emitter<Events> implements WiSunConnector {
  private serialPort: SerialPortStream;
  private parser: ReadlineParser;
  private ipv6Address: string | undefined;
  private panInfo: PanInfo | undefined;
  private side: string[];

  /**
   * BP35Connector クラスのインスタンスを初期化します。
   *
   * @param devicePath シリアルポートのパス
   * @param suportSide sideをサポートしているか
   * @param binding SerialPortのbinding
   */
  constructor(
    devicePath: string,
    suportSide: boolean,
    binding: BindingInterface = autoDetect(),
  ) {
    super();

    this.side = suportSide ? ["0"] : [];
    this.serialPort = new SerialPortStream({
      binding,
      path: devicePath,
      baudRate: BAUDRATE,
    });
    this.parser = this.serialPort.pipe(
      new DelimiterParser({ delimiter: CRLF_BUFFER }),
    );
    this.setupSerialEventHandlers();
  }

  private setupSerialEventHandlers() {
    let erxudpRemainder: Buffer | undefined = undefined;

    this.parser.on("data", (dataBuffer: Buffer) => {
      // 前回未完成分があれば結合
      if (erxudpRemainder) {
        dataBuffer = Buffer.concat([erxudpRemainder, CRLF_BUFFER, dataBuffer]);
        erxudpRemainder = undefined;
      }

      const textData = dataBuffer.toString("ascii");
      const command = textData.split(" ", 1)[0];

      if (command !== "ERXUDP") {
        // ERXUDP 以外は全体を文字列として扱う
        logger.debug(`Received TEXT data from SerialPort: ${textData}`);
        return;
      }

      const commandMatcher = textData.match(
        /^ERXUDP (?<sender>.{39}) (?<dest>.{39}) (?<rport>.{4}) (?<lport>.{4}) (?<senderlla>.{16}) (?<secured>.) ((?<side>.) )?(?<datalen>[0-9A-F]{4}) /,
      );
      if (!commandMatcher?.groups) {
        logger.error(
          `Invalid ERXUDP message format received from SerialPort: ${textData}`,
        );
        return;
      }

      // バイナリデータを切り出し
      const binaryDataStartIndex = commandMatcher[0].length;
      const binaryDataLength = parseInt(commandMatcher.groups.datalen, 16);

      const expectedEnd = binaryDataStartIndex + binaryDataLength;
      if (dataBuffer.length < expectedEnd) {
        // 未完成なので次回へ持ち越す
        erxudpRemainder = dataBuffer;
        logger.debug(
          `ERXUDP incomplete. waiting for more data. expected=${binaryDataLength}, actual=${dataBuffer.length - binaryDataStartIndex}`,
        );
        return;
      }

      const messageBuffer = dataBuffer.subarray(
        binaryDataStartIndex,
        expectedEnd,
      );

      /* v8 ignore if -- @preserve */
      if (logger.isDebugEnabled()) {
        logger.debug(
          `Parsed ERXUDP message: ${commandMatcher[0]}<HEX:${messageBuffer.toString("hex")}>`,
        );
      }

      // 送信元ポートを確認
      const srcPort = Buffer.from(
        commandMatcher.groups.rport,
        "hex",
      ).readUInt16BE(0);
      if (srcPort !== ECHONET_PORT) {
        logger.info(
          `Received data does not match ECHONET Lite format. port:${srcPort}`,
        );
        return;
      }

      try {
        const echonetData = EchonetData.parse(messageBuffer);
        this.emit("message", echonetData);
      } catch (err) {
        logger.error("Failed to parse message.", err);
        logger.error(
          `Parsed ERXUDP message: ${commandMatcher[0]}<HEX:${messageBuffer.toString("hex")}>`,
        );
      }
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
   * @param command 送信するコマンド スペースで結合し、末尾にCRLFを付与します。
   * @param expected 期待する応答テスト関数
   * @param timeout コマンドのタイムアウト時間（ミリ秒）
   * @returns コマンドの応答を配列で返します。
   */
  private sendTextCommand(
    command: string[] = [],
    expected?: (data: string) => boolean,
    timeout?: number,
  ): Promise<string[]> {
    const commandString = command.join(" ");
    return this.sendCommand(
      Buffer.concat([Buffer.from(commandString, "ascii"), CRLF_BUFFER]),
      expected,
      timeout,
    );
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
    command: Buffer,
    expected: (data: string) => boolean = (data) => data.startsWith("OK"),
    timeout: number = DEFAULT_COMMAND_TIMEOUT,
  ): Promise<string[]> {
    /* v8 ignore if -- @preserve */
    if (logger.isDebugEnabled()) {
      const commandString = command.toString("ascii").replace(CRLF, "<CRLF>");
      logger.debug(`Sending command: ${commandString}`);
    }

    // データ受信待機の開始（送信前）
    const responses: string[] = [];
    const dataPromise = pEvent(this.parser, "data", {
      timeout,
      filter: (data: Buffer) => {
        const textData = data.toString("ascii");
        responses.push(textData);
        return expected(textData) || textData.startsWith("FAIL");
      },
    });

    // コマンドを送信
    await new Promise<void>((resolve, reject) => {
      this.serialPort.write(command, (err) => {
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
      throw new Error(`Command failed. errorCode:${errorCode}`);
    }

    return responses;
  }

  /** @inheritdoc */
  async sendEchonetLite(echonetData: EchonetData): Promise<void> {
    if (!this.ipv6Address) {
      throw new Error("Not connected to the device.");
    }

    const dataBuffer = echonetData.toBuffer();

    /* v8 ignore if -- @preserve */
    if (logger.isDebugEnabled()) {
      logger.debug(`Request message: ${dataBuffer.toString("hex")}`);
    }

    const hexDataLength = this.toHex(dataBuffer.length, 4);
    const hexPort = this.toHex(ECHONET_PORT, 4);

    const command: string[] = [
      "SKSENDTO",
      "1",
      this.ipv6Address,
      hexPort,
      "1",
      ...this.side,
      hexDataLength,
    ];
    const commandString = command.join(" ") + " ";

    await this.sendCommand(
      Buffer.concat([Buffer.from(commandString, "ascii"), dataBuffer]),
    );
  }

  private toHex(value: number, width: number): string {
    return value.toString(16).toUpperCase().padStart(width, "0");
  }

  /** @inheritdoc */
  async setAuth(id: string, password: string): Promise<void> {
    logger.info("Setting authentication credentials...");
    await this.sendTextCommand(["SKSETRBID", id]);
    await this.sendTextCommand(["SKSETPWD", "C", password]);
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
    await this.sendTextCommand(["SKSREG", "S2", panInfo.Channel]);
    await this.sendTextCommand(["SKSREG", "S3", panInfo.PanID]);
    const [_echo, ipv6Address] = await this.sendTextCommand(
      ["SKLL64", panInfo.Addr],
      (data) => !data.startsWith("SKLL64"),
    );
    const responses = await this.sendTextCommand(
      ["SKJOIN", ipv6Address],
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
    const [_echo, _ok, ...responses] = await this.sendTextCommand(
      ["SKSCAN", "2", "FFFFFFFF", SCAN_DURATION.toString(), ...this.side],
      (data) => data.startsWith("EVENT 22"),
      SCAN_TIMEOUT,
    );

    const panInfo: Record<string, string> = {};
    for (const res of responses) {
      const paninfoMatcher = res.match(
        /^ {2}(?<key>[a-zA-Z ]+):(?<value>[A-Z0-9]+)/,
      );
      if (!paninfoMatcher) continue;
      assert(paninfoMatcher.groups);
      // "Pan ID" とキー名にスペースが含まれるが、扱いやすくするため削除する
      const key = paninfoMatcher.groups.key.replaceAll(" ", "");
      panInfo[key] = paninfoMatcher.groups.value;
    }
    if (!isPanInfo(panInfo)) {
      return undefined;
    }

    logger.info("PAN scan completed successfully");
    return panInfo;
  }

  /** @inheritdoc */
  async scan(maxRetries: number): Promise<PanInfo> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const panInfo = await this.scanInternal();
      if (panInfo) {
        return panInfo;
      }

      logger.warn(`Scan attempt ${attempt}/${maxRetries} failed. Retrying...`);
    }

    logger.error(`Scan failed after ${maxRetries} retries`);
    throw new Error("Wi-SUN scan failed");
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
