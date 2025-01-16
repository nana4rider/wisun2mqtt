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

- [BP35C2](https://www.furutaka-netsel.co.jp/maker/rohm/bp35c2)
