import { DeviceStatusInfo, HistoryPoint, Statistics, HistoryRange, HistoryChannel } from '../types/telemetry';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function fetchDevices(): Promise<DeviceStatusInfo[]> {
  try {
    const res = await fetch(`${API_BASE}/api/devices`);
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch devices:', err);
    return [];
  }
}

export async function fetchDeviceLatest(deviceId: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_BASE}/api/devices/${encodeURIComponent(deviceId)}/latest`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`Failed to fetch latest for ${deviceId}:`, err);
    return null;
  }
}

export async function fetchDeviceHistory(
  deviceId: string,
  range: HistoryRange = '7d',
  field: HistoryChannel = 'voltage'
): Promise<HistoryPoint[]> {
  try {
    const res = await fetch(`${API_BASE}/api/devices/${encodeURIComponent(deviceId)}/history?range=${range}&field=${field}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (err) {
    console.error(`Failed to fetch history for ${deviceId}:`, err);
    return [];
  }
}

export async function fetchDeviceStatistics(
  deviceId: string,
  range: HistoryRange = '7d',
  field: HistoryChannel = 'voltage'
): Promise<Statistics | null> {
  try {
    const res = await fetch(`${API_BASE}/api/devices/${encodeURIComponent(deviceId)}/statistics?range=${range}&field=${field}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`Failed to fetch statistics for ${deviceId}:`, err);
    return null;
  }
}

export function getExportCsvUrl(deviceId: string, range: HistoryRange = '7d'): string {
  return `${API_BASE}/api/devices/${encodeURIComponent(deviceId)}/export?range=${range}`;
}
