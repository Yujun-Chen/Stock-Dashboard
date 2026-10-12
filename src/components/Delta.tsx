import { direction, fmtPct, fmtSigned } from '../format';

interface Props {
  change?: number | null;
  pct?: number | null;
  currency?: string;
  /** Show only the percentage. */
  compact?: boolean;
}

const ARROW = { up: '▲', down: '▼', flat: '' } as const;

/** Signed change with an arrow, so direction never relies on color alone. */
export function Delta({ change, pct, currency, compact }: Props) {
  const dir = direction(pct ?? change);
  return (
    <span className={`delta ${dir}`}>
      {ARROW[dir] && <span className="delta-arrow" aria-hidden="true">{ARROW[dir]}</span>}
      {!compact && change != null && <span>{fmtSigned(change, currency)}</span>}
      {pct != null && <span>{compact || change == null ? fmtPct(pct) : `(${fmtPct(pct)})`}</span>}
    </span>
  );
}
