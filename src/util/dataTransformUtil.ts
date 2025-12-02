export function hex2ascii(hexString: string): string {
  return Buffer.from(hexString, "hex").toString("ascii");
}

export function getDecimalPlaces(value: number): number {
  const valueString = value.toString();
  const decimalIndex = valueString.indexOf(".");
  if (decimalIndex === -1) return 0;
  return valueString.length - decimalIndex - 1;
}
