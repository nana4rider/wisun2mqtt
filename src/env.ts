import { cleanEnv, num, port, str } from "envalid";

const env = cleanEnv(process.env, {
  MQTT_BROKER: str({ desc: "MQTTブローカー", example: "mqtt://localhost" }),
  MQTT_USERNAME: str({ desc: "MQTTユーザ名", default: undefined }),
  MQTT_PASSWORD: str({ desc: "MQTTパスワード", default: undefined }),
  MQTT_TASK_INTERVAL: num({ desc: "MQTTタスク実行間隔", default: 100 }),
  ENTITY_QOS: num({
    desc: "エンティティのQOS設定",
    choices: [0, 1, 2],
    default: 1,
  }),
  LOG_LEVEL: str({ default: "info", desc: "ログ出力" }),
  HA_DISCOVERY_PREFIX: str({
    desc: "https://www.home-assistant.io/integrations/mqtt/#discovery-options",
    default: "homeassistant",
  }),
  PORT: port({
    desc: "ヘルスチェック用HTTPサーバーのポート",
    default: 3000,
  }),
  AVAILABILITY_INTERVAL: num({
    desc: "オンライン状態を送信する間隔",
    default: 10000,
  }),
  ENTITY_UPDATE_INTERVAL: num({
    desc: "エンティティの更新間隔",
    default: 60000,
  }),
  WISUN_CONNECTOR: str({
    desc: "Wi-SUNコネクタ",
    default: "BP35C2",
    choices: ["BP35C2"],
  }),
  WISUN_DEVICE: str({
    desc: "デバイス名",
    default: "/dev/ttyUSB0",
    example: "/dev/ttyUSB0 or COM3",
  }),
  WISUN_SCAN_RETRIES: num({ desc: "スキャンのリトライ回数", default: 3 }),
  ROUTE_B_ID: str({ desc: "Bルート認証ID" }),
  ROUTE_B_PASSWORD: str({ desc: "Bルートパスワード" }),
});

export default env;
