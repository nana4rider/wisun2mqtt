# Wi-SUN2MQTT

[![License: ISC](https://img.shields.io/github/license/nana4rider/wisun2mqtt)](LICENSE)
![GitHub Actions Test](https://github.com/nana4rider/wisun2mqtt/actions/workflows/test.yml/badge.svg)
![GitHub Actions Release](https://github.com/nana4rider/wisun2mqtt/actions/workflows/release.yml/badge.svg)

## 概要

ECHONET Liteプロトコルを使用して、Wi-SUN対応スマートメーターから取得したデータを解析し、Home AssistantのMQTT Discovery形式で公開するアプリケーションです。

このアプリケーションにより、スマートメーターの情報をHome Assistantに自動登録し、エネルギー使用量のモニタリングや管理を簡単に行えます。

## エンティティ一覧

![Home Assistant](images/homeassistant.png)

## サポートデバイス

- ROHM BP35C2(動作確認済み)
- ROHM BP35C0
- ROHM BP35A1
- JORJIN WSR35A1-00
- ラトックシステム RS-WSUHA-P

## 使い方

必要な環境変数については[こちら](https://github.com/nana4rider/wisun2mqtt/blob/main/src/env.ts)をご確認ください。

### Native

```sh
npm install
npm run build
node --env-file=.env dist/index
```

### Docker

```sh
# .paninfo をホスト側に配置するとスキャン結果がコンテナ再起動後も残るため、次回からの接続が早くなります。
touch .paninfo

docker run -d \
  --name wisun2mqtt \
  --device /dev/ttyUSB0:/dev/ttyUSB0 \
  -v /dev/ttyUSB0:/dev/ttyUSB0 \
  -v $(pwd)/.paninfo.json:/app/.paninfo.json \
  --env-file .env \
  -p 3000:3000 \
  --restart always \
  nana4rider/wisun2mqtt:latest
```

> [!TIP]
> 必要な環境変数については[こちら](src/env.ts)をご確認ください。
