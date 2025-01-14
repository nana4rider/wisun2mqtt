import logger from "@/logger";
import Dgram, { SocketAsPromised } from "dgram-as-promised";
import { Emitter } from "strict-event-emitter";

const MULTICAST_ADDRESS = "224.0.23.0";
const PORT = 3610;

type Events = {
  message: [data: string];
  error: [err: Error];
};

export class EchonetLite extends Emitter<Events> {
  private socket: SocketAsPromised;

  constructor() {
    super();
    this.socket = Dgram.createSocket("udp4");
  }

  public async connect(): Promise<void> {
    await this.socket.bind(PORT);
    void this.startReceive();
  }

  private async startReceive() {
    try {
      for await (const packet of this.socket) {
        const message = packet.msg.toString("hex");
        logger.info(`Request from multicast: ${message}`);
        if (!message.startsWith("1081")) {
          logger.warn("Invaild message");
          return;
        }
        this.emit("message", message);
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  public async sendMulticast(data: string): Promise<void> {
    await this.socket.send(Buffer.from(data, "hex"), PORT, MULTICAST_ADDRESS);
  }

  public async close(): Promise<void> {
    await this.socket.close();
  }
}
