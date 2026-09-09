import React from 'react';
import { Zap, Sun, Moon, Clock, Cpu } from 'lucide-react';
import { ThemeMode } from '../types/telemetry';

interface HeaderProps {
  deviceId: string;
  onDeviceChange?: (id: string) => void;
  availableDevices: string[];
  wsStatus: 'LIVE' | 'RECONNECTING' | 'OFFLINE';
  deviceOnlineStatus: 'ONLINE' | 'WARNING' | 'OFFLINE';
  lastUpdateSec: number;
  theme: ThemeMode;
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  deviceId,
  onDeviceChange,
  availableDevices,
  wsStatus,
  deviceOnlineStatus,
  lastUpdateSec,
  theme,
  onToggleTheme,
}) => {
  // Compute overall visual indicator
  const isOnline = wsStatus === 'LIVE' && deviceOnlineStatus === 'ONLINE';
  const isWarning = wsStatus === 'RECONNECTING' || deviceOnlineStatus === 'WARNING';

  const statusText = wsStatus === 'RECONNECTING' 
    ? 'RECONNECTING...' 
    : deviceOnlineStatus === 'ONLINE'
    ? 'ONLINE'
    : 'OFFLINE';

  const badgeColorClass = isOnline
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    : isWarning
    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
    : 'bg-rose-500/10 text-rose-400 border-rose-500/30';

  const dotColorClass = isOnline
    ? 'bg-emerald-400 shadow-[0_0_8px_#00e676]'
    : isWarning
    ? 'bg-amber-400 animate-pulse'
    : 'bg-rose-400';

  return (
    <header className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-4 md:px-6 flex flex-wrap justify-between items-center gap-4 shadow-lg transition-colors">
      {/* Brand & Device */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#00f2fe]/20 to-[#3b82f6]/20 border border-[#00f2fe]/40 flex items-center justify-center text-[var(--primary-cyan)] shadow-sm">
          <Zap className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-[var(--text-main)]">
              ESP32 Energy Monitor
            </h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
            <Cpu className="w-3.5 h-3.5 text-[var(--primary-blue)]" />
            <span>Device:</span>
            {availableDevices.length > 1 ? (
              <select
                value={deviceId}
                onChange={(e) => onDeviceChange && onDeviceChange(e.target.value)}
                className="bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-main)] rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:border-[var(--border-highlight)]"
              >
                {availableDevices.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            ) : (
              <span className="font-semibold text-[var(--primary-cyan)]">{deviceId}</span>
            )}
          </div>
        </div>
      </div>

      {/* Right Controls: Theme, Connection Status, Last Update */}
      <div className="flex items-center gap-3">
        {/* Theme Switcher */}
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-input)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-color)] text-[var(--text-main)] transition-colors shadow-sm"
          title="Toggle Light / Dark Mode"
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>Light Mode</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-indigo-500" />
              <span>Dark Mode</span>
            </>
          )}
        </button>

        {/* Live Status Badge */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border ${badgeColorClass} transition-colors`}>
          <span className={`w-2 h-2 rounded-full ${dotColorClass}`}></span>
          <span>{statusText}</span>
        </div>

        {/* Last Data Timer */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-muted)]">
          <Clock className="w-3.5 h-3.5 text-[var(--text-dim)]" />
          <span>Last: {lastUpdateSec < 1 ? `${(lastUpdateSec * 10).toFixed(0)}00ms` : `${lastUpdateSec.toFixed(1)}s`}</span>
        </div>
      </div>
    </header>
  );
};
