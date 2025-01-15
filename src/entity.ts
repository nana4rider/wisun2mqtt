export type Entity = {
  id: string;
  name: string;
  domain: Domain;
  deviceClass: DeviceClass;
  stateClass?: StateClass;
  unit?: Unit;
  unitType?: string;
  unitPrecision?: number;
  epc: string;
  converter: (value: string) => string;
};

type Domain = "sensor" | "binary_sensor";
type DeviceClass = "running" | "problem" | "power" | "current" | "energy";
type StateClass = "measurement" | "total_increasing";
type Unit = "W" | "A" | "kWh";
