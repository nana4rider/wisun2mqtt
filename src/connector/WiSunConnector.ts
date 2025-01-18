import { BP35Connector } from "@/connector/BP35Connector";
import { WiSunConnectorModel } from "@/connector/WiSunConnectorModel";

export type PanInfo = {
  [name in string]: string;
};

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
   */
  sendEchonetLite(data: Buffer): Promise<void>;

  /**
   * Wi-SUN モジュールの認証情報を設定します。
   *
   * @param id BルートID
   * @param password Bルートパスワード
   */
  setAuth(id: string, password: string): Promise<void>;

  /**
   * PAN スキャンを実行し、利用可能なネットワークを検索します。
   *
   * @param maxRetries 最大リトライ回数
   * @param retryInterval リトライ間隔
   * @returns PAN 情報
   * @throws スキャンが失敗した場合
   */
  scan(maxRetries: number, retryInterval?: number): Promise<PanInfo>;

  /**
   * PAN の説明を使用して Wi-SUN ネットワークに接続します。
   *
   * @param panInfo PAN情報
   * @returns 接続が確立されたときに解決されるPromise
   * @throws 接続に失敗した場合や予期しないイベントが発生した場合
   */
  join(panInfo: PanInfo): Promise<void>;

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
 * @param model Wi-SUNコネクタのモデル
 * @param device シリアルポートのパス
 * @returns
 */
export default function createWiSunConnector(
  model: WiSunConnectorModel,
  device: string,
): WiSunConnector {
  switch (model) {
    case "BP35C0":
    case "BP35C2":
    case "RS-WSUHA-P":
      return new BP35Connector(device, 0);
    case "BP35A1":
    case "WSR35A1-00":
      return new BP35Connector(device);
    default:
      throw new Error(`Unsupported model: ${String(model)}`);
  }
}
