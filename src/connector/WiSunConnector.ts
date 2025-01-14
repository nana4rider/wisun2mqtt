import logger from "@/logger";
import { ReadlineParser } from "@serialport/parser-readline";
import { SerialPort } from "serialport";
import { Emitter } from "strict-event-emitter";

const BAUDRATE = 115200;
const SCAN_DURATION = 7;

export type PanDescription = {
  panId: string;
  channel: string;
  channelPage: string;
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

  constructor(path: string) {
    super();
    this.serialPort = new SerialPort({
      path,
      baudRate: BAUDRATE,
    });
    this.parser = this.serialPort.pipe(
      new ReadlineParser({ delimiter: "\r\n" }),
    );

    this.parser.on("data", (data: string) => {
      if (!data.startsWith("ERXUDP")) return;
      logger.info(`Response from smart meter: ${data}`);
      const arrayData = data.split(" ");
      const message = arrayData[arrayData.length - 1];
      if (message.startsWith("1081")) {
        logger.warn("Invaild message");
        return;
      }
      this.emit("message", message);
    });

    this.serialPort.on("error", (err) => {
      this.emit("error", err);
    });
  }

  public async sendEchonetData(data: string): Promise<string> {
    if (!this.ipv6Address) {
      throw new Error("not connected.");
    }
    const [_echo, _event21, _ok, erxudp] = await this.sendCommand(
      `SKSENDTO 1 ${this.ipv6Address} 0E1A 1 ${data}`,
      (data) => data.startsWith("ERXUDP"),
    );
    return erxudp;
  }

  private sendCommand(
    command: string,
    end: (data: string) => boolean = (data) => data === "OK",
    timeout: number = 5000,
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const responses: string[] = [];
      let timeoutId: NodeJS.Timeout;

      const onData = (data: string) => {
        responses.push(data);
        if (end(data)) {
          clearTimeout(timeoutId);
          this.parser.removeListener("data", onData);
          resolve(responses);
        }
      };

      // シリアルポートにコマンドを送信
      this.serialPort.write(`${command}\r\n`, (err) => {
        if (err) {
          clearTimeout(timeoutId);
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

  public async getVersion(): Promise<string> {
    const [_echo, ever] = await this.sendCommand("SKVER");
    const [version] = ever.split(" ");
    return version;
  }

  public async setAuth(id: string, password: string): Promise<void> {
    await this.sendCommand(`SKSETPWD C ${password}`);
    await this.sendCommand(`SKSETRBID ${id}`);
  }

  public async connect({
    channel,
    panId,
    addr,
  }: PanDescription): Promise<void> {
    await this.sendCommand(`SKSREG S2 ${channel}`);
    await this.sendCommand(`SKSREG S3 ${panId}`);
    const [_echo, ipv6Address] = await this.sendCommand(`SKLL64 ${addr}`);
    this.ipv6Address = ipv6Address;
  }

  public async executeScan(): Promise<PanDescription | undefined> {
    const responses = await this.sendCommand(
      `SKSCAN 2 FFFFFFFF ${SCAN_DURATION}`,
      (data) => data.startsWith("EVENT 22"),
      20,
    );

    if (responses.length <= 3) return undefined;

    const scanRecord: Record<string, string> = {};
    responses
      .filter((res) => !res.startsWith("  "))
      .forEach((res) => {
        const separatorIndex = res.indexOf(":");
        if (separatorIndex !== -1) return;
        const key = res.substring(2, separatorIndex);
        const value = res.substring(separatorIndex + 1);
        scanRecord[key] = value;
      });

    const description: PanDescription = {
      panId: scanRecord["Pan ID"],
      channel: scanRecord["Channel"],
      channelPage: scanRecord["Channel Page"],
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
