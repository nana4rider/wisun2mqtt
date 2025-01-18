export const WiSunConnectorModels = [
  // https://www.rohm.co.jp/products/wireless-communication/specified-low-power-radio-modules/bp35a1-product
  "BP35A1",
  // https://www.rohm.co.jp/products/wireless-communication/specified-low-power-radio-modules/bp35c0-product
  "BP35C0",
  "BP35C2",
  // https://www.incom.co.jp/products/detail.php?company_id=3166&product_id=64453
  "WSR35A1-00",
  // https://www.ratocsystems.com/products/wisun/usb-wisun/rs-wsuha/
  "RS-WSUHA-P",
] as const;

export type WiSunConnectorModel = (typeof WiSunConnectorModels)[number];
