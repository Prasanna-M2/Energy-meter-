export interface TelemetryData {
  voltage: number;
  current: number;
  power: number;
  frequency: number;
  rssi?: number;
  uptime?: number;
  status?: string;
}

export interface WebSocketTelemetryMessage {
  type: string;
  device_id: string;
  timestamp: number;
  data: TelemetryData;
}

export interface DeviceStatusInfo {
  device_id: string;
  status: 'ONLINE' | 'WARNING' | 'OFFLINE';
  last_seen: number;
  rssi?: number;
  uptime?: number;
  firmware_version?: string;
}

export interface HistoryPoint {
  time: string;
  timestamp: number;
  value: number;
}

export interface Statistics {
  device_id: string;
  range: string;
  field: string;
  current: number;
  min: number;
  max: number;
  avg: number;
}

export type ScopeChannel = 'voltage' | 'current' | 'power';
export type HistoryChannel = 'voltage' | 'current' | 'power' | 'frequency';
export type TimeWindowSec = 15 | 30 | 60;
export type HistoryRange = '1h' | '6h' | '1d' | '3d' | '7d';
export type ThemeMode = 'dark' | 'light';
