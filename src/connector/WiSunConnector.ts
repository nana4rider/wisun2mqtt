import { BP35C2Connector } from "@/connector/BP35C2Connector";

export interface WiSunConnector {
  /**
   * イベントリスナーを登録します。
   *
   * @param event イベント名 ("message" または "error")
   * @param listener イベント発生時に呼び出されるリスナー関数
   */
  on(event: "message", listener: (message: Buffer) => void): this;
  on(event: "error", listener: (err: Error) => void): this;

  /**
   * ECHONET Lite データを送信します。
   *
   * @param data 送信するデータ
   * @returns 受信したデータ
   */
  sendEchonetLite(data: Buffer): Promise<Buffer>;

  /**
   * Wi-SUN モジュールをリセットします。
   */
  reset(): Promise<void>;

  /**
   * Wi-SUN モジュールの認証情報を設定します。
   *
   * @param id BルートID
   * @param password Bルートパスワード
   */
  setAuth(id: string, password: string): Promise<void>;

  /**
   * PAN をスキャンしてネットワークに接続します。
   *
   * @param maxRetries 最大リトライ回数
   * @param retryInterval リトライ間隔
   */
  scanAndJoin(maxRetries: number, retryInterval?: number): Promise<void>;

  /**
   * シリアルポートを閉じ、リソースを解放します。
   *
   * @returns シリアルポートが正常に閉じられたときに解決されるPromise
   * @throws シリアルポートのクローズに失敗した場合
   */
  close(): Promise<void>;
}

/**
 * 指定したモデルのWi-SUNコネクタのインスタンスを取得します
 *
 * @param model
 * @param device シリアルポートのパス
 * @returns
 */
export default function createWiSunConnector(
  model: string,
  device: string,
): WiSunConnector {
  switch (model) {
    case "BP35C2":
      return new BP35C2Connector(device);
    default:
      throw new Error(`Unsupported model: ${model}`);
  }
}
