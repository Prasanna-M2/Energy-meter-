import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Activity, Play, Pause, Maximize2 } from 'lucide-react';
import { ScopeChannel, TimeWindowSec, ThemeMode } from '../types/telemetry';

interface WaveformPoint {
  time: string;
  timestamp: number;
  voltage: number;
  current: number;
  power: number;
}

interface RealtimeWaveformProps {
  dataPoints: WaveformPoint[];
  theme: ThemeMode;
  isPaused: boolean;
  onTogglePause: () => void;
}

export const RealtimeWaveform: React.FC<RealtimeWaveformProps> = ({
  dataPoints,
  theme,
  isPaused,
  onTogglePause,
}) => {
  const [selectedChannel, setSelectedChannel] = useState<ScopeChannel>('voltage');
  const [timeWindow, setTimeWindow] = useState<TimeWindowSec>(15);

  // Filter points based on selected time window (e.g. 15s, 30s, 60s)
  const filteredData = useMemo(() => {
    if (dataPoints.length === 0) return [];
    const latestTime = dataPoints[dataPoints.length - 1].timestamp;
    const cutoffTime = latestTime - timeWindow * 1000;
    return dataPoints.filter((pt) => pt.timestamp >= cutoffTime);
  }, [dataPoints, timeWindow]);

  // Color & Unit configurations for channels
  const channelConfig = {
    voltage: {
      name: 'Voltage',
      unit: 'V',
      color: '#00f2fe',
      gradientStart: 'rgba(0, 242, 254, 0.25)',
      gradientEnd: 'rgba(0, 242, 254, 0.01)',
    },
    current: {
      name: 'Current',
      unit: 'A',
      color: '#3b82f6',
      gradientStart: 'rgba(59, 130, 246, 0.25)',
      gradientEnd: 'rgba(59, 130, 246, 0.01)',
    },
    power: {
      name: 'Active Power',
      unit: 'W',
      color: '#ff9800',
      gradientStart: 'rgba(255, 152, 0, 0.25)',
      gradientEnd: 'rgba(255, 152, 0, 0.01)',
    },
  };

  const currentCfg = channelConfig[selectedChannel];

  // ECharts Option
  const option = useMemo(() => {
    const isDark = theme === 'dark';
    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(36, 52, 84, 0.4)' : 'rgba(203, 213, 225, 0.6)';
    const crosshairColor = isDark ? 'rgba(0, 242, 254, 0.4)' : 'rgba(2, 132, 199, 0.4)';

    const seriesData = filteredData.map((pt) => [
      pt.timestamp,
      selectedChannel === 'voltage' ? pt.voltage : selectedChannel === 'current' ? pt.current : pt.power,
    ]);

    return {
      backgroundColor: 'transparent',
      animation: false, // Smooth continuous update without stutter
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          crossStyle: {
            color: crosshairColor,
            width: 1,
            type: 'dashed',
          },
        },
        backgroundColor: isDark ? '#131b2e' : '#ffffff',
        borderColor: isDark ? '#243454' : '#cbd5e1',
        textStyle: {
          color: isDark ? '#f1f5f9' : '#0f172a',
          fontFamily: 'JetBrains Mono',
          fontSize: 12,
        },
        formatter: (params: any) => {
          if (!params || !params[0]) return '';
          const p = params[0];
          const date = new Date(p.value[0]);
          const timeStr = date.toTimeString().split(' ')[0] + '.' + String(date.getMilliseconds()).padStart(3, '0');
          return `
            <div style="padding: 2px 4px;">
              <div style="font-size: 10px; color: ${textColor}; margin-bottom: 2px;">${timeStr}</div>
              <div style="font-weight: 700; color: ${currentCfg.color}; font-size: 14px;">
                ${p.value[1]} ${currentCfg.unit}
              </div>
            </div>
          `;
        },
      },
      grid: {
        top: 24,
        right: 20,
        bottom: 30,
        left: 55,
      },
      xAxis: {
        type: 'time',
        boundaryGap: false,
        axisLine: {
          lineStyle: { color: isDark ? '#243454' : '#cbd5e1' },
        },
        axisLabel: {
          color: textColor,
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          formatter: (val: number) => {
            const d = new Date(val);
            return `${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
          },
        },
        splitLine: {
          show: true,
          lineStyle: { color: gridColor, type: 'dashed' },
        },
      },
      yAxis: {
        type: 'value',
        scale: true, // Auto-scaling
        axisLine: {
          lineStyle: { color: isDark ? '#243454' : '#cbd5e1' },
        },
        axisLabel: {
          color: textColor,
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          formatter: `{value} ${currentCfg.unit}`,
        },
        splitLine: {
          show: true,
          lineStyle: { color: gridColor, type: 'dashed' },
        },
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'none',
        },
      ],
      series: [
        {
          name: currentCfg.name,
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: seriesData,
          lineStyle: {
            width: 2.5,
            color: currentCfg.color,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: currentCfg.gradientStart },
                { offset: 1, color: currentCfg.gradientEnd },
              ],
            },
          },
        },
      ],
    };
  }, [filteredData, selectedChannel, theme, currentCfg]);

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5 shadow-lg transition-colors">
      {/* Title & Toolbar */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4 pb-3 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[var(--bg-input)] text-[var(--primary-cyan)]">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-wider uppercase text-[var(--text-main)] font-mono">
              REAL-TIME WAVEFORM
            </h2>
            <span className="text-[11px] text-[var(--text-dim)] font-mono">
              Live Stream &bull; Buffer: 60s max &bull; Sampling: ~500ms
            </span>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Signal Selector */}
          <div className="flex items-center bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg p-0.5">
            <button
              onClick={() => setSelectedChannel('voltage')}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                selectedChannel === 'voltage'
                  ? 'bg-[#00f2fe]/20 text-[#00f2fe] font-bold border border-[#00f2fe]/40'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              Voltage
            </button>
            <button
              onClick={() => setSelectedChannel('current')}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                selectedChannel === 'current'
                  ? 'bg-[#3b82f6]/20 text-[#3b82f6] font-bold border border-[#3b82f6]/40'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              Current
            </button>
            <button
              onClick={() => setSelectedChannel('power')}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                selectedChannel === 'power'
                  ? 'bg-[#ff9800]/20 text-[#ff9800] font-bold border border-[#ff9800]/40'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              Power
            </button>
          </div>

          {/* Time Window Selector */}
          <div className="flex items-center bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg p-0.5">
            {[15, 30, 60].map((sec) => (
              <button
                key={sec}
                onClick={() => setTimeWindow(sec as TimeWindowSec)}
                className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                  timeWindow === sec
                    ? 'bg-[var(--border-highlight)] text-white font-bold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>

          {/* Pause / Resume Button */}
          <button
            onClick={onTogglePause}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-mono rounded-lg border transition-colors ${
              isPaused
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'bg-[var(--bg-input)] text-[var(--text-main)] border-[var(--border-color)] hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{isPaused ? 'Resume' : 'Pause'}</span>
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-[320px]">
        {filteredData.length > 0 ? (
          <ReactECharts
            option={option}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-dim)] font-mono text-xs">
            <Activity className="w-8 h-8 mb-2 opacity-30 animate-pulse" />
            <span>Waiting for real-time telemetry stream...</span>
          </div>
        )}
      </div>
    </div>
  );
};
