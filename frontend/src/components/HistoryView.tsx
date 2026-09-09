import React, { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { Database, Download, AlertCircle, Loader2 } from 'lucide-react';
import { HistoryRange, HistoryChannel, HistoryPoint, Statistics, ThemeMode } from '../types/telemetry';
import { fetchDeviceHistory, fetchDeviceStatistics, getExportCsvUrl } from '../services/api';

interface HistoryViewProps {
  deviceId: string;
  theme: ThemeMode;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ deviceId, theme }) => {
  const [range, setRange] = useState<HistoryRange>('7d');
  const [field, setField] = useState<HistoryChannel>('voltage');
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [stats, setStats] = useState<Statistics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const channelConfig = {
    voltage: { name: 'Voltage', unit: 'V', color: '#00f2fe' },
    current: { name: 'Current', unit: 'A', color: '#3b82f6' },
    power: { name: 'Active Power', unit: 'W', color: '#ff9800' },
    frequency: { name: 'Frequency', unit: 'Hz', color: '#00e676' },
  };

  const currentCfg = channelConfig[field];

  // Fetch data and statistics whenever deviceId, range, or field changes
  useEffect(() => {
    let isCancelled = false;
    async function loadHistory() {
      setIsLoading(true);
      try {
        const [historyPoints, statistics] = await Promise.all([
          fetchDeviceHistory(deviceId, range, field),
          fetchDeviceStatistics(deviceId, range, field),
        ]);
        if (!isCancelled) {
          setData(historyPoints);
          setStats(statistics);
        }
      } catch (err) {
        console.error('Failed to load history data:', err);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    loadHistory();
    return () => {
      isCancelled = true;
    };
  }, [deviceId, range, field]);

  // ECharts Option for historical data
  const option = React.useMemo(() => {
    const isDark = theme === 'dark';
    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(36, 52, 84, 0.4)' : 'rgba(203, 213, 225, 0.6)';

    const seriesData = data.map((pt) => [pt.timestamp, pt.value]);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'line',
          lineStyle: { color: currentCfg.color, type: 'dashed' },
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
          return `
            <div style="padding: 2px 4px;">
              <div style="font-size: 10px; color: ${textColor}; margin-bottom: 2px;">
                ${date.toLocaleDateString()} ${date.toLocaleTimeString()}
              </div>
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
        },
        splitLine: {
          show: true,
          lineStyle: { color: gridColor, type: 'dashed' },
        },
      },
      yAxis: {
        type: 'value',
        scale: true,
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
        },
      ],
      series: [
        {
          name: currentCfg.name,
          type: 'line',
          smooth: true,
          showSymbol: data.length < 50,
          symbolSize: 4,
          data: seriesData,
          lineStyle: {
            width: 2,
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
                { offset: 0, color: `${currentCfg.color}33` },
                { offset: 1, color: `${currentCfg.color}05` },
              ],
            },
          },
        },
      ],
    };
  }, [data, field, theme, currentCfg]);

  const ranges: HistoryRange[] = ['1h', '6h', '1d', '3d', '7d'];
  const fields: HistoryChannel[] = ['voltage', 'current', 'power', 'frequency'];

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5 shadow-lg transition-colors">
      {/* Header & Controls */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4 pb-3 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[var(--bg-input)] text-[var(--accent-green)]">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-wider uppercase text-[var(--text-main)] font-mono">
              7-DAY HISTORY
            </h2>
            <span className="text-[11px] text-[var(--text-dim)] font-mono">
              InfluxDB OSS &bull; Auto-Downsampled &bull; Retention: 7 Days
            </span>
          </div>
        </div>

        {/* Toolbar: Time Range, Signal, Export */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Time Range Selector */}
          <div className="flex items-center bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg p-0.5">
            {ranges.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 text-xs font-mono rounded uppercase transition-colors ${
                  range === r
                    ? 'bg-[var(--border-highlight)] text-white font-bold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Signal Selector */}
          <div className="flex items-center bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg p-0.5">
            {fields.map((f) => (
              <button
                key={f}
                onClick={() => setField(f)}
                className={`px-2.5 py-1 text-xs font-mono rounded capitalize transition-colors ${
                  field === f
                    ? 'bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Export CSV Button */}
          <a
            href={getExportCsvUrl(deviceId, range)}
            download
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-semibold rounded-lg bg-[var(--primary-cyan)]/10 hover:bg-[var(--primary-cyan)]/20 text-[var(--primary-cyan)] border border-[var(--primary-cyan)]/30 transition-colors shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {/* Summary Statistics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <div className="bg-[var(--bg-input)]/70 border border-[var(--border-color)] rounded-lg px-3 py-2">
          <div className="text-[10px] text-[var(--text-dim)] font-mono uppercase">Current</div>
          <div className="text-sm font-bold font-mono text-[var(--text-main)]">
            {stats ? `${stats.current} ${currentCfg.unit}` : '---'}
          </div>
        </div>
        <div className="bg-[var(--bg-input)]/70 border border-[var(--border-color)] rounded-lg px-3 py-2">
          <div className="text-[10px] text-[var(--text-dim)] font-mono uppercase">Minimum</div>
          <div className="text-sm font-bold font-mono text-[var(--accent-green)]">
            {stats ? `${stats.min} ${currentCfg.unit}` : '---'}
          </div>
        </div>
        <div className="bg-[var(--bg-input)]/70 border border-[var(--border-color)] rounded-lg px-3 py-2">
          <div className="text-[10px] text-[var(--text-dim)] font-mono uppercase">Maximum</div>
          <div className="text-sm font-bold font-mono text-[var(--accent-red)]">
            {stats ? `${stats.max} ${currentCfg.unit}` : '---'}
          </div>
        </div>
        <div className="bg-[var(--bg-input)]/70 border border-[var(--border-color)] rounded-lg px-3 py-2">
          <div className="text-[10px] text-[var(--text-dim)] font-mono uppercase">Average</div>
          <div className="text-sm font-bold font-mono text-[var(--primary-cyan)]">
            {stats ? `${stats.avg} ${currentCfg.unit}` : '---'}
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-[280px] relative">
        {isLoading ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-dim)] font-mono text-xs">
            <Loader2 className="w-6 h-6 mb-2 animate-spin text-[var(--primary-cyan)]" />
            <span>Retrieving historical records from InfluxDB...</span>
          </div>
        ) : data.length > 0 ? (
          <ReactECharts
            option={option}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-dim)] font-mono text-xs">
            <AlertCircle className="w-7 h-7 mb-2 opacity-40 text-amber-400" />
            <span>No data available for this time range.</span>
          </div>
        )}
      </div>
    </div>
  );
};
