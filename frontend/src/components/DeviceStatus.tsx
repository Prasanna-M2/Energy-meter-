import React from 'react';
import { Cpu, Wifi, Clock, Activity } from 'lucide-react';
import { DeviceStatusInfo } from '../types/telemetry';

interface DeviceStatusProps {
  deviceId: string;
  status: 'ONLINE' | 'WARNING' | 'OFFLINE';
  rssi?: number;
  lastSeenSec: number;
}

export const DeviceStatus: React.FC<DeviceStatusProps> = ({
  deviceId,
  status,
  rssi,
  lastSeenSec,
}) => {
  const isOnline = status === 'ONLINE';

  return (
    <footer className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-3.5 px-5 flex flex-wrap justify-between items-center gap-3 text-xs font-mono shadow-md transition-colors">
      {/* Device ID */}
      <div className="flex items-center gap-2">
        <Cpu className="w-4 h-4 text-[var(--primary-blue)]" />
        <span className="text-[var(--text-muted)]">DEVICE:</span>
        <span className="font-bold text-[var(--text-main)]">{deviceId}</span>
      </div>

      {/* Online / Offline Status */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-[#00e676] shadow-[0_0_8px_#00e676]' : 'bg-[#ff5252]'}`}></span>
        <span className={`font-semibold ${isOnline ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      {/* Wi-Fi RSSI */}
      <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
        <Wifi className="w-3.5 h-3.5 text-[var(--primary-cyan)]" />
        <span>Wi-Fi:</span>
        <span className="font-semibold text-[var(--text-main)]">
          {rssi !== undefined ? `${rssi} dBm` : '-- dBm'}
        </span>
      </div>

      {/* Last Data Received */}
      <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
        <Clock className="w-3.5 h-3.5 text-[var(--accent-orange)]" />
        <span>Last Data:</span>
        <span className="font-semibold text-[var(--text-main)]">
          {lastSeenSec < 1 ? `${(lastSeenSec * 10).toFixed(0)}00ms` : `${lastSeenSec.toFixed(1)}s`}
        </span>
      </div>
    </footer>
  );
};
