import { cleanEnv, num, str } from "envalid";

const env = cleanEnv(process.env, {
  LOG_LEVEL: str({ default: "info", desc: "ログ出力" }),
  WISUN_DEVICE: str({ desc: "デバイス名", example: "/dev/ttyUSB0" }),
  WISUN_SCAN_RETRIES: num({ desc: "スキャンのリトライ回数", default: 3 }),
  WISUN_COMMAND_TIMEOUT: num({
    desc: "スキャンを除くコマンドのタイムアウト",
    default: 5000,
  }),
  ROUTE_B_ID: str({ desc: "Bルート認証ID" }),
  ROUTE_B_PASSWORD: str({ desc: "Bルートパスワード" }),
});

export default env;
