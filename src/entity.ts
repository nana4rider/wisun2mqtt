export type Entity = {
  id: string;
  name: string;
  domain: Domain;
  deviceClass?: DeviceClass;
  stateClass?: StateClass;
  unit?: Unit;
  unitType?: UnitType;
  unitPrecision?: number;
};

export type Domain = "sensor" | "binary_sensor";

export type DeviceClass = "energy";

export type StateClass = "total_increasing";

export type Unit = "kWh";

export type UnitType = "float";
