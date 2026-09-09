import React from 'react';
import { Zap, Activity, Gauge, Radio } from 'lucide-react';
import { TelemetryData } from '../types/telemetry';

interface MetricCardsProps {
  telemetry: TelemetryData | null;
  isOnline: boolean;
}

export const MetricCards: React.FC<MetricCardsProps> = ({ telemetry, isOnline }) => {
  const voltage = isOnline && telemetry ? telemetry.voltage.toFixed(1) : '0.0';
  const current = isOnline && telemetry ? telemetry.current.toFixed(2) : '0.00';
  const power = isOnline && telemetry ? telemetry.power.toFixed(1) : '0.0';
  const frequency = isOnline && telemetry ? telemetry.frequency.toFixed(1) : '0.0';

  const cards = [
    {
      title: 'VOLTAGE',
      value: voltage,
      unit: 'V',
      subText: 'Nominal 230 V',
      subDetail: 'AC Mains',
      icon: Zap,
      accentColor: 'text-[#00f2fe]',
      borderColor: 'border-[#00f2fe]/30 hover:border-[#00f2fe]/60',
      glowColor: 'hover:shadow-[0_0_15px_rgba(0,242,254,0.15)]',
      dotColor: 'bg-[#00f2fe]',
    },
    {
      title: 'CURRENT',
      value: current,
      unit: 'A',
      subText: 'RMS Measurement',
      subDetail: 'Load Draw',
      icon: Activity,
      accentColor: 'text-[#3b82f6]',
      borderColor: 'border-[#3b82f6]/30 hover:border-[#3b82f6]/60',
      glowColor: 'hover:shadow-[0_0_15px_rgba(59,130,246,0.15)]',
      dotColor: 'bg-[#3b82f6]',
    },
    {
      title: 'POWER',
      value: power,
      unit: 'W',
      subText: 'Active Power',
      subDetail: 'Real Load',
      icon: Gauge,
      accentColor: 'text-[#ff9800]',
      borderColor: 'border-[#ff9800]/30 hover:border-[#ff9800]/60',
      glowColor: 'hover:shadow-[0_0_15px_rgba(255,152,0,0.15)]',
      dotColor: 'bg-[#ff9800]',
    },
    {
      title: 'FREQUENCY',
      value: frequency,
      unit: 'Hz',
      subText: 'Grid Stability',
      subDetail: '50.0 Hz Std',
      icon: Radio,
      accentColor: 'text-[#00e676]',
      borderColor: 'border-[#00e676]/30 hover:border-[#00e676]/60',
      glowColor: 'hover:shadow-[0_0_15px_rgba(0,230,118,0.15)]',
      dotColor: 'bg-[#00e676]',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div
            key={idx}
            className={`bg-[var(--bg-card)] border ${card.borderColor} ${card.glowColor} rounded-xl p-5 flex flex-col justify-between transition-all duration-200 shadow-md`}
          >
            {/* Header: Title & Icon */}
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-semibold tracking-wider text-[var(--text-muted)] font-mono">
                {card.title}
              </span>
              <div className={`p-2 rounded-lg bg-[var(--bg-input)] ${card.accentColor}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>

            {/* Value & Unit */}
            <div className="flex items-baseline gap-2 my-1">
              <span className="text-3xl sm:text-4xl font-extrabold font-mono text-[var(--text-main)] tracking-tight">
                {card.value}
              </span>
              <span className={`text-sm font-bold font-mono ${card.accentColor}`}>
                {card.unit}
              </span>
            </div>

            {/* Sub-status Indicator */}
            <div className="flex items-center justify-between text-xs text-[var(--text-dim)] font-mono mt-3 pt-3 border-t border-[var(--border-color)]">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? card.dotColor : 'bg-gray-500'}`}></span>
                <span>{card.subText}</span>
              </div>
              <span>{card.subDetail}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
