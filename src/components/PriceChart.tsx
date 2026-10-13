import { useMemo } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartData, ChartPoint } from '../api';
import { fmtCompact, fmtPct, fmtPrice, fmtSigned } from '../format';

export type ChartType = 'line' | 'candles';

interface Props {
  data: ChartData;
  type?: ChartType;
  showVolume?: boolean;
}

const AXIS_WIDTH = 60;
const MAX_X_TICKS = 8;

function makeFormatters(data: ChartData) {
  const tz = data.timezone;
  const f = (opts: Intl.DateTimeFormatOptions) => {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
    return (t: number) => fmt.format(t);
  };
  const day = f({ year: 'numeric', month: 'numeric', day: 'numeric' });
  // Intraday bars need the time of day in the tooltip, whatever the range.
  const time: Intl.DateTimeFormatOptions = data.intraday ? { hour: 'numeric', minute: '2-digit' } : {};
  switch (data.range) {
    case '1D':
      return { tick: f({ hour: 'numeric', minute: '2-digit' }), tip: f({ month: 'short', day: 'numeric', ...time }), day };
    case '5D':
      return { tick: f({ weekday: 'short', day: 'numeric' }), tip: f({ weekday: 'short', month: 'short', day: 'numeric', ...time }), day };
    case '5Y':
    case 'MAX':
      return { tick: f({ year: 'numeric' }), tip: f({ month: 'short', day: 'numeric', year: 'numeric' }), day };
    default:
      return { tick: f({ month: 'short', day: 'numeric' }), tip: f({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', ...time }), day };
  }
}

/** Keep at most MAX_X_TICKS of the candidates, evenly spaced and anchored on the latest. */
function thin(ticks: number[]): number[] {
  const step = Math.ceil(ticks.length / MAX_X_TICKS);
  return ticks.filter((_, i) => (ticks.length - 1 - i) % step === 0);
}

/** One candlestick: a wick from low to high and a body from open to close. */
function Candle({ x = 0, y = 0, width = 0, height = 0, payload }: { x?: number; y?: number; width?: number; height?: number; payload?: ChartPoint }) {
  if (!payload) return null;
  const { o, h, l, c } = payload;
  const span = h - l;
  const pixels = Math.abs(height);
  const yOf = (v: number) => (span > 0 ? y + ((h - v) / span) * pixels : y);
  const top = yOf(Math.max(o, c));
  const bodyWidth = Math.max(1, Math.min(width * 0.7, 12));
  const cx = x + width / 2;
  const color = c >= o ? 'var(--up-mark)' : 'var(--down-mark)';
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + pixels} stroke={color} strokeWidth={1} />
      <rect x={cx - bodyWidth / 2} y={top} width={bodyWidth} height={Math.max(1, yOf(Math.min(o, c)) - top)} fill={color} />
    </g>
  );
}

export function PriceChart({ data, type = 'line', showVolume = true }: Props) {
  const { points, baseline, currency } = data;
  const candles = type === 'candles';
  const fmt = useMemo(() => makeFormatters(data), [data]);

  const { domain, ticks, yTicks, step } = useMemo(() => {
    const values = candles ? points.flatMap((p) => [p.l, p.h]) : points.map((p) => p.c);
    if (data.range === '1D' && baseline != null) values.push(baseline);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Round the y-axis to clean steps (1, 2, 2.5 or 5 times a power of ten).
    const raw = (max - min || Math.abs(max) * 0.02 || 1) / 5;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const yTicks: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) yTicks.push(Number(v.toPrecision(12)));
    // Multi-day intraday charts: tick at each session start. Long ranges: at each new year.
    // Otherwise let the axis choose.
    let ticks: number[] | undefined;
    if (data.intraday && data.range !== '1D') {
      ticks = thin(points.filter((p, i) => i === 0 || fmt.day(p.t) !== fmt.day(points[i - 1].t)).map((p) => p.t));
    } else if (data.range === '5Y' || data.range === 'MAX') {
      ticks = thin(points.filter((p, i) => i > 0 && fmt.tick(p.t) !== fmt.tick(points[i - 1].t)).map((p) => p.t));
    }
    return { domain: [lo, hi] as [number, number], ticks, yTicks, step };
  }, [points, baseline, candles, data.range, data.intraday, fmt]);

  if (points.length < 2) return <div className="chart-empty">No chart data for this range.</div>;

  const digits = Math.min(4, (String(step).split('.')[1] ?? '').length);
  const yTick = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const hasVolume = showVolume && points.some((p) => p.v > 0);

  const tooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as ChartPoint;
    const diff = baseline != null ? p.c - baseline : null;
    const row = (label: string, value: string) => (
      <div className="chart-tip-row">
        <span>{label}</span>
        <span>{value}</span>
      </div>
    );
    return (
      <div className="chart-tip">
        <div className="chart-tip-date">{fmt.tip(p.t)}</div>
        <div className="chart-tip-value">{fmtPrice(p.c, currency)}</div>
        {candles && (
          <>
            {row('Open', fmtPrice(p.o))}
            {row('High', fmtPrice(p.h))}
            {row('Low', fmtPrice(p.l))}
            {row('Close', fmtPrice(p.c))}
          </>
        )}
        {diff != null && baseline ? row(`vs. ${data.range === '1D' ? 'prev. close' : 'start'}`, `${fmtSigned(diff)} (${fmtPct((diff / baseline) * 100)})`) : null}
        {hasVolume && row('Volume', fmtCompact(p.v))}
      </div>
    );
  };

  const xAxis = (hide: boolean) => (
    <XAxis
      dataKey="t"
      hide={hide}
      ticks={ticks}
      tickFormatter={fmt.tick}
      minTickGap={56}
      tickLine={false}
      axisLine={{ stroke: 'var(--axis)' }}
      tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
      tickMargin={8}
    />
  );

  return (
    <div className="price-chart">
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={points} syncId="price" margin={{ top: 8, right: 0, bottom: 0, left: 8 }} barCategoryGap={0}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          {xAxis(false)}
          <YAxis
            orientation="right"
            width={AXIS_WIDTH}
            domain={domain}
            tickFormatter={yTick}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            ticks={yTicks}
          />
          <Tooltip
            content={tooltip}
            cursor={candles ? { fill: 'var(--hover)' } : { stroke: 'var(--axis)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {data.range === '1D' && baseline != null && (
            <ReferenceLine
              y={baseline}
              stroke="var(--text-muted)"
              strokeDasharray="3 4"
              label={{ value: 'Prev. close', position: 'insideBottomLeft', fill: 'var(--text-muted)', fontSize: 11 }}
            />
          )}
          {candles ? (
            <Bar dataKey={(p: ChartPoint) => [p.l, p.h]} shape={<Candle />} isAnimationActive={false} />
          ) : (
            <Area
              type="linear"
              dataKey="c"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeLinejoin="round"
              fill="url(#priceFill)"
              isAnimationActive={false}
              dot={false}
              activeDot={{ r: 4, fill: 'var(--series-1)', stroke: 'var(--surface-1)', strokeWidth: 2 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {hasVolume && (
        <>
          <div className="chart-sub">Volume</div>
          <ResponsiveContainer width="100%" height={84}>
            <BarChart data={points} syncId="price" margin={{ top: 0, right: 0, bottom: 0, left: 8 }}>
              {xAxis(true)}
              <YAxis
                orientation="right"
                width={AXIS_WIDTH}
                tickFormatter={fmtCompact}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                tickCount={3}
              />
              <Tooltip content={() => null} cursor={{ fill: 'var(--hover)' }} isAnimationActive={false} />
              <Bar dataKey="v" fill="var(--volume)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
