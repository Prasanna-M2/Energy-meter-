import React, { useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { Database, Download, AlertCircle, Loader2, FileSpreadsheet, ExternalLink, RefreshCw, Check, Trash2 } from 'lucide-react';
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
  const [sheetSyncing, setSheetSyncing] = useState<boolean>(false);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);

  const channelConfig = {
    power: { name: 'Active Power', unit: 'W', color: '#ff9800' },
    voltage: { name: 'Voltage', unit: 'V', color: '#00f2fe' },
    current: { name: 'Current', unit: 'A', color: '#3b82f6' },
    pf: { name: 'Power Factor', unit: '', color: '#c084fc' },
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

  const [chartType, setChartType] = useState<'line' | 'bar' | 'area' | 'step' | 'scatter'>('area');

  const ranges: HistoryRange[] = ['1h', '6h', '1d', '3d', '7d'];
  const fields: HistoryChannel[] = ['power', 'voltage', 'current', 'pf', 'frequency'];

  // ECharts Option for historical data with multiple graph representations
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
          type: chartType === 'bar' ? 'shadow' : 'cross',
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
          type: chartType === 'bar' ? 'bar' : chartType === 'scatter' ? 'scatter' : 'line',
          step: chartType === 'step' ? 'middle' : false,
          smooth: chartType === 'line' || chartType === 'area',
          showSymbol: chartType === 'scatter' || data.length < 50,
          symbolSize: chartType === 'scatter' ? 7 : 4,
          data: seriesData,
          itemStyle: {
            color: currentCfg.color,
          },
          lineStyle: chartType === 'scatter' ? undefined : {
            width: 2.5,
            color: currentCfg.color,
          },
          areaStyle: chartType === 'area' ? {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${currentCfg.color}44` },
                { offset: 1, color: `${currentCfg.color}05` },
              ],
            },
          } : undefined,
        },
      ],
    };
  }, [data, field, theme, currentCfg, chartType]);

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
              TELEMETRY STORAGE &amp; MULTI-GRAPH ANALYTICS
            </h2>
            <span className="text-[11px] text-[var(--text-dim)] font-mono">
              Plotting last 100 telemetry points &bull; Live updates 1-by-1
            </span>
          </div>
        </div>

        {/* Toolbar: Graph Type, Signal, Export */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Graph Representation Type Selector */}
          <div className="flex items-center bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg p-0.5">
            <button
              onClick={() => setChartType('area')}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                chartType === 'area' ? 'bg-[#00f2fe] text-slate-950 font-bold' : 'text-[var(--text-muted)]'
              }`}
            >
              Area Peak
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                chartType === 'line' ? 'bg-[#00f2fe] text-slate-950 font-bold' : 'text-[var(--text-muted)]'
              }`}
            >
              Line Trend
            </button>
            <button
              onClick={() => setChartType('bar')}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                chartType === 'bar' ? 'bg-[#00f2fe] text-slate-950 font-bold' : 'text-[var(--text-muted)]'
              }`}
            >
              Bar Chart
            </button>
            <button
              onClick={() => setChartType('step')}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                chartType === 'step' ? 'bg-[#00f2fe] text-slate-950 font-bold' : 'text-[var(--text-muted)]'
              }`}
            >
              Stepped Wave
            </button>
            <button
              onClick={() => setChartType('scatter')}
              className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                chartType === 'scatter' ? 'bg-[#00f2fe] text-slate-950 font-bold' : 'text-[var(--text-muted)]'
              }`}
            >
              Scatter Plot
            </button>
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

          {/* Export Full CSV Button */}
          <a
            href={getExportCsvUrl(deviceId, 'all')}
            download
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded-lg bg-[var(--primary-cyan)] text-slate-950 hover:bg-[var(--primary-cyan)]/90 transition-colors shadow-sm"
            title="Download full continuous telemetry dataset stored in Cloud"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export ALL CSV</span>
          </a>

          {/* Push to Google Sheets Button */}
          <button
            onClick={async () => {
              setSheetSyncing(true);
              setSheetMessage(null);
              try {
                const res = await fetch('/api/sheets/log-now', { method: 'POST' });
                const json = await res.json();
                if (res.ok && json.status === 'success') {
                  setSheetMessage('Telemetry row successfully recorded into Google Sheet!');
                } else {
                  setSheetMessage(json.message || 'Logged snapshot to Google Sheet');
                }
              } catch (err: any) {
                setSheetMessage('Sync error: ' + err.message);
              } finally {
                setSheetSyncing(false);
                setTimeout(() => setSheetMessage(null), 4000);
              }
            }}
            disabled={sheetSyncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-sm disabled:opacity-50"
            title="Immediately push current telemetry snapshot to Google Sheet"
          >
            {sheetSyncing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
            )}
            <span>Push to Sheet</span>
          </button>

          {/* Pull/Sync from Google Sheets */}
          <button
            onClick={async () => {
              setSheetSyncing(true);
              setSheetMessage(null);
              try {
                const res = await fetch('/api/sheets/sync');
                const json = await res.json();
                if (res.ok && json.status === 'success') {
                  setSheetMessage(`Successfully synced ${json.total_rows} records from Google Sheets!`);
                } else {
                  setSheetMessage(json.message || 'Synced records from Google Sheet');
                }
              } catch (err: any) {
                setSheetMessage('Sync error: ' + err.message);
              } finally {
                setSheetSyncing(false);
                setTimeout(() => setSheetMessage(null), 4000);
              }
            }}
            disabled={sheetSyncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-sm disabled:opacity-50"
            title="Fetch records from Google Sheet into table"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${sheetSyncing ? 'animate-spin' : ''}`} />
            <span>Sync from Sheet</span>
          </button>

          {/* Open Google Sheet External Link */}
          <a
            href="https://docs.google.com/spreadsheets/d/1HfwPPmaKPXMQbgyVnA0lcn1-Qb0trAjJqRtT_kI4Rac/edit?usp=sharing"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-semibold rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            title="Open Google Spreadsheet in new tab"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Open Sheet</span>
          </a>

          {/* Clear Stored Telemetry */}
          <button
            onClick={async () => {
              if (!confirm('Are you sure you want to clear all stored telemetry records?')) return;
              try {
                const res = await fetch('/api/telemetry/clear', { method: 'POST' });
                if (res.ok) {
                  setData([]);
                  setStats(null);
                  setSheetMessage('All telemetry records cleared.');
                  setTimeout(() => setSheetMessage(null), 3000);
                }
              } catch (e: any) {
                setSheetMessage('Clear error: ' + e.message);
              }
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-semibold rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white transition-colors"
            title="Clear all stored telemetry records"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Google Sheet Sync Feedback Toast */}
      {sheetMessage && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-between text-xs font-mono text-emerald-300 animate-fadeIn">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{sheetMessage}</span>
          </div>
          <span className="text-[10px] text-emerald-400/70">Google Sheets Webhook Connected</span>
        </div>
      )}

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
      <div className="w-full h-[280px] relative mb-6">
        {isLoading ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-dim)] font-mono text-xs">
            <Loader2 className="w-6 h-6 mb-2 animate-spin text-[var(--primary-cyan)]" />
            <span>Loading 100 telemetry graph points...</span>
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
            <span>No telemetry data points logged yet.</span>
          </div>
        )}
      </div>

      {/* Sliding Window 50 Telemetry Table */}
      <SlidingTelemetryTable deviceId={deviceId} />
    </div>
  );
};

// Recent 50 Telemetry Sliding Table Component (Deletes oldest 1-by-1, retains max 50)
const SlidingTelemetryTable: React.FC<{ deviceId: string }> = ({ deviceId }) => {
  const [records, setRecords] = useState<any[]>([]);

  useEffect(() => {
    async function fetchRecent50() {
      try {
        const res = await fetch(`/api/telemetry/recent?deviceId=${encodeURIComponent(deviceId)}`);
        if (res.ok) {
          const json = await res.json();
          if (json.records) setRecords(json.records);
        }
      } catch (err) {
        console.error('Failed to fetch recent 50 telemetry records:', err);
      }
    }

    fetchRecent50();
    const interval = setInterval(fetchRecent50, 1000);
    return () => clearInterval(interval);
  }, [deviceId]);

  return (
    <div className="border-t border-[var(--border-color)] pt-4 mt-2">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#00f2fe] animate-pulse"></span>
          <h3 className="text-xs font-bold font-mono text-[var(--text-main)] uppercase tracking-wider">
            Live Telemetry Log (Last 50 Entries · 1-in 1-out FIFO Deletion)
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Google Sheets: Auto-Logging (Row-by-Row)
          </span>
          <span className="text-[11px] font-mono text-[var(--text-dim)] font-semibold">
            Displaying {records.length} / 50 Records
          </span>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[300px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] shadow-inner">
        <table className="w-full text-left text-xs font-mono border-collapse">
          <thead className="bg-[var(--bg-input)] text-[var(--text-muted)] sticky top-0 z-10 border-b border-[var(--border-color)]">
            <tr>
              <th className="p-2.5 px-3">Date</th>
              <th className="p-2.5 px-3">Time</th>
              <th className="p-2.5 px-3">Device ID</th>
              <th className="p-2.5 px-3">Voltage (V)</th>
              <th className="p-2.5 px-3">Current (A)</th>
              <th className="p-2.5 px-3">Power (W)</th>
              <th className="p-2.5 px-3">Energy (kWh)</th>
              <th className="p-2.5 px-3">Freq (Hz)</th>
              <th className="p-2.5 px-3">PF</th>
              <th className="p-2.5 px-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-color)]/50">
            {records.length > 0 ? (
              records.map((r, idx) => (
                <tr key={r.id || idx} className="hover:bg-[var(--bg-card-hover)] transition-colors">
                  <td className="p-2 px-3 text-[var(--text-muted)]">{r.date}</td>
                  <td className="p-2 px-3 font-semibold text-[var(--text-main)]">{r.time}</td>
                  <td className="p-2 px-3 text-[var(--primary-cyan)]">{r.deviceId}</td>
                  <td className="p-2 px-3 text-amber-400 font-semibold">{r.voltage.toFixed(1)} V</td>
                  <td className="p-2 px-3 text-blue-400 font-semibold">{r.current.toFixed(2)} A</td>
                  <td className="p-2 px-3 text-orange-400 font-bold">{r.power.toFixed(1)} W</td>
                  <td className="p-2 px-3 text-purple-400 font-semibold">{r.energy.toFixed(4)} kWh</td>
                  <td className="p-2 px-3 text-emerald-400">{r.frequency.toFixed(1)} Hz</td>
                  <td className="p-2 px-3 text-sky-400">{r.pf.toFixed(2)}</td>
                  <td className="p-2 px-3">
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-bold ${
                      r.status === 'ONLINE' 
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} className="p-6 text-center text-[var(--text-dim)]">
                  Waiting for telemetry packets... (Website displays last 50 entries 1-by-1)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
