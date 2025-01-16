export function convertUnitForCumulativeElectricEnergy(value: number): number {
  const valueMap: { [key: number]: number } = {
    0x00: 1,
    0x01: 0.1,
    0x02: 0.01,
    0x03: 0.001,
    0x04: 0.0001,
    0x0a: 10,
    0x0b: 100,
    0x0c: 1000,
    0x0d: 10000,
  };

  if (!(value in valueMap)) {
    throw new Error(`Invalid E1 value: ${value}`);
  }

  return valueMap[value];
}
