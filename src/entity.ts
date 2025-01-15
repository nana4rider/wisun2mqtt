export type Entity = {
  id: string;
  name: string;
  domain: Domain;
  deviceClass: DeviceClass;
  stateClass?: StateClass;
  unit?: Unit;
  nativeValue?: NativeValue;
  unitPrecision?: number;
  epc: number;
  converter: (value: number) => string;
};

type Domain = "sensor" | "binary_sensor";
type DeviceClass = "running" | "problem" | "power" | "current" | "energy";
type StateClass = "measurement" | "total_increasing";
type Unit = "W" | "A" | "kWh";
type NativeValue = "int" | "float";
