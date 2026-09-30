import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { MetricCards } from './components/MetricCards';
import { RealtimeWaveform } from './components/RealtimeWaveform';
import { HistoryView } from './components/HistoryView';
import { DeviceStatus } from './components/DeviceStatus';
import { wsClient } from './services/websocket';
import { fetchDevices } from './services/api';
import { TelemetryData, WebSocketTelemetryMessage, ThemeMode } from './types/telemetry';

interface WaveformPoint {
  time: string;
  timestamp: number;
  voltage: number;
  current: number;
  power: number;
}

export const App: React.FC = () => {
  // State
  const [deviceId, setDeviceId] = useState<string>('ESP32-001');
  const [availableDevices, setAvailableDevices] = useState<string[]>(['ESP32-001']);
  const [wsStatus, setWsStatus] = useState<'LIVE' | 'RECONNECTING' | 'OFFLINE'>('RECONNECTING');
  const [currentTelemetry, setCurrentTelemetry] = useState<TelemetryData | null>(null);
  const [lastDataTimestamp, setLastDataTimestamp] = useState<number>(0);
  const [secondsSinceLastData, setSecondsSinceLastData] = useState<number>(999);
  const [deviceOnlineStatus, setDeviceOnlineStatus] = useState<'ONLINE' | 'WARNING' | 'OFFLINE'>('OFFLINE');
  const [isWaveformPaused, setIsWaveformPaused] = useState<boolean>(false);
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [waveformBuffer, setWaveformBuffer] = useState<WaveformPoint[]>([]);

  // Ref to hold waveform points for fast synchronous updates without React state lag
  const bufferRef = useRef<WaveformPoint[]>([]);
  const isPausedRef = useRef<boolean>(false);
  isPausedRef.current = isWaveformPaused;

  // Sync theme with DOM documentElement
  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  // Poll available devices once on startup
  useEffect(() => {
    fetchDevices().then((devs) => {
      if (devs && devs.length > 0) {
        const ids = devs.map((d) => d.device_id);
        setAvailableDevices((prev) => Array.from(new Set([...prev, ...ids])));
      }
    });
  }, []);

  // Connect to WebSocket and subscribe to messages & status
  useEffect(() => {
    wsClient.connect();

    const unsubStatus = wsClient.onStatusChange((status) => {
      setWsStatus(status);
    });

    const unsubMsg = wsClient.subscribe((msg: WebSocketTelemetryMessage) => {
      // Register device ID if new
      setAvailableDevices((prev) => {
        if (!prev.includes(msg.device_id)) {
          return [...prev, msg.device_id];
        }
        return prev;
      });

      // Filter for active device
      if (msg.device_id === deviceId) {
        const now = Date.now();
        setLastDataTimestamp(now);
        setCurrentTelemetry(msg.data);

        // Update waveform buffer (max 150 points = ~75 seconds at 500ms intervals)
        if (!isPausedRef.current) {
          const newPt: WaveformPoint = {
            time: new Date(msg.timestamp).toLocaleTimeString(),
            timestamp: msg.timestamp,
            voltage: msg.data.voltage,
            current: msg.data.current,
            power: msg.data.power,
          };

          const updated = [...bufferRef.current, newPt];
          // Keep strictly within rolling limit (last 150 points)
          if (updated.length > 150) {
            updated.shift();
          }
          bufferRef.current = updated;
          setWaveformBuffer(updated);
        }
      }
    });

    return () => {
      unsubStatus();
      unsubMsg();
      wsClient.disconnect();
    };
  }, [deviceId]);

  // Periodic ticker to compute secondsSinceLastData and device online status
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastDataTimestamp === 0) {
        setSecondsSinceLastData(999);
        setDeviceOnlineStatus('OFFLINE');
        return;
      }

      const elapsed = (Date.now() - lastDataTimestamp) / 1000;
      setSecondsSinceLastData(elapsed);

      if (elapsed < 5.0) {
        setDeviceOnlineStatus('ONLINE');
      } else if (elapsed <= 15.0) {
        setDeviceOnlineStatus('WARNING');
      } else {
        setDeviceOnlineStatus('OFFLINE');
      }
    }, 200);

    return () => clearInterval(interval);
  }, [lastDataTimestamp]);

  const [scrollProgress, setScrollProgress] = useState<number>(0);

  // Track window scroll progress for top scroll bar animation
  useEffect(() => {
    const handleScroll = () => {
      const totalScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (totalScroll > 0) {
        setScrollProgress((window.scrollY / totalScroll) * 100);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen max-w-7xl mx-auto p-4 md:p-6 flex flex-col gap-5 relative">
      {/* Top Scroll Indicator Progress Bar */}
      <div 
        className="fixed top-0 left-0 h-1 bg-gradient-to-r from-[#00f2fe] via-[#3b82f6] to-[#00e676] z-50 transition-all duration-75"
        style={{ width: `${scrollProgress}%` }}
      />

      {/* 1. Header */}
      <div className="animate-fade-in">
        <Header
          deviceId={deviceId}
          onDeviceChange={setDeviceId}
          availableDevices={availableDevices}
          wsStatus={wsStatus}
          deviceOnlineStatus={deviceOnlineStatus}
          lastUpdateSec={secondsSinceLastData}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </div>

      {/* 2. Live Measurements: Exactly 4 cards */}
      <div className="animate-slide-up" style={{ animationDelay: '0.05s' }}>
        <MetricCards
          telemetry={currentTelemetry}
          isOnline={deviceOnlineStatus === 'ONLINE'}
        />
      </div>

      {/* 3. Real-Time Waveform */}
      <div className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
        <RealtimeWaveform
          dataPoints={waveformBuffer}
          theme={theme}
          isPaused={isWaveformPaused}
          onTogglePause={() => setIsWaveformPaused((prev) => !prev)}
        />
      </div>

      {/* 4. 7-Day History */}
      <div className="animate-slide-up" style={{ animationDelay: '0.15s' }}>
        <HistoryView
          deviceId={deviceId}
          theme={theme}
        />
      </div>

      {/* 5. Device Status Footer */}
      <div className="animate-slide-up" style={{ animationDelay: '0.2s' }}>
        <DeviceStatus
          deviceId={deviceId}
          status={deviceOnlineStatus}
          rssi={currentTelemetry?.rssi}
          lastSeenSec={secondsSinceLastData}
        />
      </div>
    </div>
  );
};

export default App;
