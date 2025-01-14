import { cleanEnv, str } from "envalid";

const env = cleanEnv(process.env, {
  LOG_LEVEL: str({ default: "info", desc: "ログ出力" }),
  WISUN_DEVICE: str({ desc: "デバイス名", example: "/dev/ttyUSB0" }),
  ROUTE_B_ID: str({ desc: "Bルート認証ID" }),
  ROUTE_B_PASSWORD: str({ desc: "Bルートパスワード" }),
});

export default env;
