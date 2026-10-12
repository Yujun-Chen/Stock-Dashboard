import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartData } from '../api';
import { fmtCompact, fmtPct, fmtPrice, fmtSigned } from '../format';

interface Props {
  data: ChartData;
  showVolume?: boolean;
}

const AXIS_WIDTH = 60;

function makeFormatters(data: ChartData) {
  const tz = data.timezone;
  const f = (opts: Intl.DateTimeFormatOptions) => {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
    return (t: number) => fmt.format(t);
  };
  const day = f({ year: 'numeric', month: 'numeric', day: 'numeric' });
  switch (data.range) {
    case '1D':
      return { tick: f({ hour: 'numeric', minute: '2-digit' }), tip: f({ hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }), day };
    case '5D':
      return { tick: f({ weekday: 'short', day: 'numeric' }), tip: f({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), day };
    case '5Y':
    case 'MAX':
      return { tick: f({ year: 'numeric' }), tip: f({ month: 'short', day: 'numeric', year: 'numeric' }), day };
    default:
      return { tick: f({ month: 'short', day: 'numeric' }), tip: f({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), day };
  }
}

export function PriceChart({ data, showVolume = true }: Props) {
  const { points, baseline, currency } = data;
  const fmt = useMemo(() => makeFormatters(data), [data]);

  const { domain, ticks, yTicks, step } = useMemo(() => {
    const closes = points.map((p) => p.c);
    if (data.intraday && data.range === '1D' && baseline != null) closes.push(baseline);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    // Round the y-axis to clean steps (1, 2, 2.5 or 5 times a power of ten).
    const raw = (max - min || Math.abs(max) * 0.02 || 1) / 5;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const yTicks: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) yTicks.push(Number(v.toPrecision(12)));
    // 5D: one tick per session; long ranges: one per year. Otherwise let the axis choose.
    let ticks: number[] | undefined;
    if (data.range === '5D') {
      ticks = points.filter((p, i) => i === 0 || fmt.day(p.t) !== fmt.day(points[i - 1].t)).map((p) => p.t);
    } else if (data.range === '5Y' || data.range === 'MAX') {
      const firsts = points.filter((p, i) => i > 0 && fmt.tick(p.t) !== fmt.tick(points[i - 1].t)).map((p) => p.t);
      const step = Math.ceil(firsts.length / 8);
      ticks = firsts.filter((_, i) => (firsts.length - 1 - i) % step === 0);
    }
    return { domain: [lo, hi] as [number, number], ticks, yTicks, step };
  }, [points, baseline, data.range, data.intraday, fmt]);

  if (points.length < 2) return <div className="chart-empty">No chart data for this range.</div>;

  const digits = Math.min(4, (String(step).split('.')[1] ?? '').length);
  const yTick = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const hasVolume = showVolume && points.some((p) => p.v > 0);

  const tooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload as { t: number; c: number; v: number };
    const diff = baseline != null ? p.c - baseline : null;
    return (
      <div className="chart-tip">
        <div className="chart-tip-date">{fmt.tip(p.t)}</div>
        <div className="chart-tip-value">{fmtPrice(p.c, currency)}</div>
        {diff != null && baseline ? (
          <div className="chart-tip-row">
            <span>vs. {data.range === '1D' ? 'prev. close' : 'start'}</span>
            <span>
              {fmtSigned(diff)} ({fmtPct((diff / baseline) * 100)})
            </span>
          </div>
        ) : null}
        {hasVolume && (
          <div className="chart-tip-row">
            <span>Volume</span>
            <span>{fmtCompact(p.v)}</span>
          </div>
        )}
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
        <AreaChart data={points} syncId="price" margin={{ top: 8, right: 0, bottom: 0, left: 8 }}>
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
          <Tooltip content={tooltip} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} isAnimationActive={false} />
          {data.range === '1D' && baseline != null && (
            <ReferenceLine
              y={baseline}
              stroke="var(--text-muted)"
              strokeDasharray="3 4"
              label={{ value: 'Prev. close', position: 'insideBottomLeft', fill: 'var(--text-muted)', fontSize: 11 }}
            />
          )}
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
        </AreaChart>
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
