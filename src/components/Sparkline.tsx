import type { Spark } from '../api';

interface Props {
  spark: Spark | null | undefined;
  width?: number;
  height?: number;
}

/** Intraday trend line; the dashed rule marks the previous close. */
export function Sparkline({ spark, width = 104, height = 30 }: Props) {
  if (!spark || spark.closes.length < 2) {
    return <svg className="spark" width={width} height={height} aria-hidden="true" />;
  }
  const { closes, baseline } = spark;
  const values = baseline != null ? [...closes, baseline] : closes;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i / (closes.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const path = closes.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c).toFixed(1)}`).join('');
  const last = closes[closes.length - 1];
  const dir = baseline == null || last === baseline ? 'flat' : last > baseline ? 'up' : 'down';

  return (
    <svg className={`spark ${dir}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {baseline != null && <line className="spark-base" x1={pad} x2={width - pad} y1={y(baseline)} y2={y(baseline)} />}
      <path className="spark-line" d={path} />
    </svg>
  );
}
