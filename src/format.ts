const DASH = '—';

export function fmtPrice(n: number | null | undefined, currency?: string): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const digits = Math.abs(n) < 1 ? 4 : 2;
  const opts: Intl.NumberFormatOptions = { minimumFractionDigits: digits, maximumFractionDigits: digits };
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', { ...opts, style: 'currency', currency }).format(n);
    } catch {
      // unknown currency code: fall through to a plain number
    }
  }
  return new Intl.NumberFormat('en-US', opts).format(n);
}

export function fmtSigned(n: number | null | undefined, currency?: string): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  // A change keeps 2 decimals (0.57, not 0.5700) unless it would round to zero.
  const body = abs >= 0.005 && abs < 1 ? fmtPrice(abs + 1, currency).replace('1.', '0.') : fmtPrice(abs, currency);
  return (n > 0 ? '+' : n < 0 ? '−' : '') + body;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(2) + '%';
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return compact.format(n);
}

export function fmtNumber(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtClock(t: number | null | undefined): string {
  if (!t) return DASH;
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function direction(n: number | null | undefined): 'up' | 'down' | 'flat' {
  if (n == null || !Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

export function marketStateLabel(state: string | undefined): string {
  switch (state) {
    case 'REGULAR':
      return 'Market open';
    case 'PRE':
    case 'PREPRE':
      return 'Pre-market';
    case 'POST':
    case 'POSTPOST':
      return 'After hours';
    case 'CLOSED':
      return 'Market closed';
    default:
      return '';
  }
}
