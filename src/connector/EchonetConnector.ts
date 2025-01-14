import logger from "@/logger";
import Dgram, { SocketAsPromised } from "dgram-as-promised";
import { Emitter } from "strict-event-emitter";

const MULTICAST_ADDRESS = "224.0.23.0"; // マルチキャストアドレス
const PORT = 3610; // ポート番号

// イベントの型定義
type Events = {
  message: [data: string]; // UDPメッセージを受信
  error: [err: Error]; // エラーイベント
};

export class EchonetConnector extends Emitter<Events> {
  private socket: SocketAsPromised;

  constructor() {
    super();
    this.socket = Dgram.createSocket("udp4");
  }

  // ソケットをバインドしてメッセージ受信を開始
  public async connect(): Promise<void> {
    try {
      logger.info(`Binding UDP socket to port ${PORT}`);
      await this.socket.bind(PORT);
      logger.info("UDP socket successfully bound");
      void this.startReceive(); // 非同期で受信処理を開始
    } catch (err) {
      logger.error("Failed to bind UDP socket:", err);
      throw err;
    }
  }

  // メッセージ受信処理
  private async startReceive() {
    try {
      for await (const packet of this.socket) {
        const message = packet.msg.toString("hex");
        logger.debug(`Received UDP message: ${message}`);

        // ECHONET Liteメッセージか確認
        if (!message.startsWith("1081")) {
          logger.warn(`Invalid ECHONET Lite message: ${message}`);
          continue; // 無効なメッセージはスキップ
        }

        this.emit("message", message); // 有効なメッセージをイベントとして発火
      }
    } catch (err) {
      logger.error("Error occurred while receiving UDP messages:", err);
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  // UDPマルチキャストでデータを送信
  public async sendMulticast(data: string): Promise<void> {
    try {
      logger.debug(`Sending UDP multicast message: ${data}`);
      await this.socket.send(Buffer.from(data, "hex"), PORT, MULTICAST_ADDRESS);
      logger.info(`Message successfully sent to ${MULTICAST_ADDRESS}:${PORT}`);
    } catch (err) {
      logger.error("Failed to send UDP multicast message:", err);
      throw err;
    }
  }

  // ソケットをクローズ
  public async close(): Promise<void> {
    try {
      logger.info("Closing UDP socket");
      await this.socket.close();
      logger.info("UDP socket successfully closed");
    } catch (err) {
      logger.error("Failed to close UDP socket:", err);
      throw err;
    }
  }
}
