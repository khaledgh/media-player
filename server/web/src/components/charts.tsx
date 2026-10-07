import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { cx } from './ui';
import type { DayPoint } from '../api';

/** Plays-per-day area chart with a hover read-out. Pure SVG, no chart library. */
export function AreaChart({ data, height = 200 }: { data: DayPoint[]; height?: number }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const max = Math.max(4, ...data.map((d) => d.plays));
  const niceMax = Math.ceil(max / 4) * 4;
  const x = (i: number) => pad.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / niceMax) * (height - pad.t - pad.b);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.plays).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${height - pad.b} L${x(0).toFixed(1)},${height - pad.b} Z`;
  const total = data.reduce((n, d) => n + d.plays, 0);
  const h = hover !== null ? data[hover] : null;
  const ticks = [0, 0.5, 1].map((f) => Math.round(niceMax * f));
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  if (!total) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted" style={{ height }}>
        No listening yet — plays show up here once people use the app.
      </div>
    );
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Plays per day, ${total} in total`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.min(data.length - 1, Math.max(0, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (data.length - 1)))));
        }}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray="3 5" />
            <text x={W - pad.r} y={y(t) - 4} textAnchor="end" fontSize="10" fill="var(--color-muted)">
              {t}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke="var(--color-brand)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {data.map(
          (d, i) =>
            i % labelEvery === 0 && (
              <text key={d.day} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
                {new Date(d.day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </text>
            ),
        )}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--color-muted)" strokeOpacity="0.5" />
            <circle cx={x(hover)} cy={y(data[hover].plays)} r="5" fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs shadow-xl"
          style={{ left: `${(x(hover!) / W) * 100}%` }}
        >
          <p className="text-muted">{new Date(h.day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
          <p className="font-semibold tabular-nums">
            {h.plays} play{h.plays === 1 ? '' : 's'}
          </p>
        </div>
      )}
    </div>
  );
}

/** A ranked list where each row shows its share as a bar. */
export function RankList<T>({
  items,
  label,
  sub,
  value,
  unit,
  empty,
}: {
  items: T[];
  label: (i: T) => ReactNode;
  sub?: (i: T) => ReactNode;
  value: (i: T) => number;
  unit?: string;
  empty: string;
}) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const max = Math.max(1, ...items.map(value));
  return (
    <ol className="space-y-3">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-3">
          <span
            className={cx(
              'flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums',
              i === 0 ? 'bg-brand text-white' : 'bg-surface-2 text-muted',
            )}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-medium" dir="auto">
                {label(it)}
              </p>
              <p className="shrink-0 text-sm font-semibold tabular-nums">
                {value(it).toLocaleString()}
                {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
              </p>
            </div>
            {sub && (
              <p className="truncate text-xs text-muted" dir="auto">
                {sub(it)}
              </p>
            )}
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line/70">
              <div className="h-full rounded-full bg-brand/80" style={{ width: `${(value(it) / max) * 100}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function KPI({
  icon,
  label,
  value,
  hint,
  tone = 'brand',
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'brand' | 'ok' | 'danger' | 'info';
}) {
  const tones = {
    brand: 'bg-brand/12 text-brand',
    ok: 'bg-ok/12 text-ok',
    danger: 'bg-danger/12 text-danger',
    info: 'bg-sky-400/12 text-sky-400',
  };
  return (
    <div className="rounded-2xl border border-line/60 bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
        <div className={cx('flex size-9 items-center justify-center rounded-xl', tones[tone])}>{icon}</div>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function RangePicker({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div role="tablist" className="inline-flex rounded-xl bg-surface-2 p-1">
      {[7, 30, 90].map((d) => (
        <button
          key={d}
          role="tab"
          aria-selected={value === d}
          onClick={() => onChange(d)}
          className={cx('rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors', value === d ? 'bg-brand text-white' : 'text-muted hover:text-white')}
        >
          {d} days
        </button>
      ))}
    </div>
  );
}
