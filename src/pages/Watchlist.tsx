import { Fragment } from 'react';
import { api, type Quote } from '../api';
import { Delta } from '../components/Delta';
import { PageHead, stockHref } from '../components/PageHead';
import { Sparkline } from '../components/Sparkline';
import { SymbolSearch } from '../components/SymbolSearch';
import { fmtCompact, fmtPrice } from '../format';
import { useLocalStorage, usePolling } from '../hooks';

type GroupBy = 'none' | 'sector' | 'industry';

const GROUPINGS: [GroupBy, string][] = [
  ['none', 'None'],
  ['sector', 'Sector'],
  ['industry', 'Industry'],
];

// Funds, indices and currencies have no sector; group them by what they are.
function fallbackGroup(q: Quote | undefined): string {
  switch (q?.type) {
    case 'ETF':
    case 'MUTUALFUND':
      return 'Funds';
    case 'INDEX':
      return 'Indices';
    case 'CRYPTOCURRENCY':
      return 'Crypto';
    case 'CURRENCY':
      return 'Currencies';
    case 'FUTURE':
      return 'Futures';
    default:
      return 'Other';
  }
}

interface Props {
  symbols: string[];
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

export function Watchlist({ symbols, onAdd, onRemove }: Props) {
  const key = symbols.join(',');
  const quotes = usePolling(`wl:${key}`, (signal) => api.quotes(symbols, signal), 30_000);
  const sparks = usePolling(`wl-sparks:${key}`, (signal) => api.sparks(symbols, signal), 120_000);
  const bySymbol = new Map((quotes.data ?? []).map((q) => [q.symbol, q]));

  const [groupBy, setGroupBy] = useLocalStorage<GroupBy>('watchlist.groupBy', 'none');
  const sectors = usePolling(`wl-sectors:${groupBy === 'none' ? '' : key}`, (signal) =>
    groupBy === 'none' ? Promise.resolve(undefined) : api.sectors(symbols, signal),
  );
  const grouped = groupBy !== 'none' && sectors.data !== undefined;

  // Named groups A–Z, with the no-sector buckets (funds, indices, …) after them.
  const groups: { label: string | null; symbols: string[]; named: boolean }[] = [];
  if (!grouped) {
    groups.push({ label: null, symbols, named: false });
  } else {
    const byLabel = new Map<string, { label: string; symbols: string[]; named: boolean }>();
    for (const symbol of symbols) {
      const own = sectors.data?.[symbol]?.[groupBy as 'sector' | 'industry'];
      const label = own ?? fallbackGroup(bySymbol.get(symbol));
      if (!byLabel.has(label)) byLabel.set(label, { label, symbols: [], named: Boolean(own) });
      byLabel.get(label)!.symbols.push(symbol);
    }
    groups.push(...[...byLabel.values()].sort((a, b) => Number(b.named) - Number(a.named) || a.label.localeCompare(b.label)));
  }

  return (
    <>
      <PageHead
        title="Watchlist"
        subtitle={`${symbols.length} ${symbols.length === 1 ? 'symbol' : 'symbols'}, saved in this browser`}
        marketState={quotes.data?.[0]?.marketState}
        updatedAt={quotes.updatedAt}
        error={quotes.error}
      >
        <div className="group-by">
          <span className="sub">Group by</span>
          <div className="tabs" role="tablist" aria-label="Group by">
            {GROUPINGS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={id === groupBy} className={id === groupBy ? 'active' : ''} onClick={() => setGroupBy(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <SymbolSearch onSelect={onAdd} placeholder="Add a symbol" />
      </PageHead>

      <section className="card card-flush">
        {symbols.length === 0 ? (
          <div className="empty">Your watchlist is empty. Search for a symbol above to add one.</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Today</th>
                  <th className="num">Price</th>
                  <th className="num">Change</th>
                  <th className="num">Volume</th>
                  <th className="num">Market cap</th>
                  <th>52-week range</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const changes = group.symbols.map((s) => bySymbol.get(s)?.changePct).filter((v): v is number => v != null);
                  const avg = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null;
                  return (
                    <Fragment key={group.label ?? 'all'}>
                      {group.label && (
                        <tr className="group-row">
                          <td colSpan={3}>
                            <span className="strong">{group.label}</span>
                            <span className="sub group-count">
                              {group.symbols.length} {group.symbols.length === 1 ? 'symbol' : 'symbols'}
                            </span>
                          </td>
                          <td className="num">
                            {group.symbols.length > 1 && avg != null && (
                              <>
                                <span className="sub">Avg. </span>
                                <Delta pct={avg} compact />
                              </>
                            )}
                          </td>
                          <td colSpan={4} />
                        </tr>
                      )}
                      {group.symbols.map((symbol) => {
                  const q = bySymbol.get(symbol);
                  const missing = !q && !quotes.loading && quotes.data;
                  return (
                    <tr key={symbol} className="row-link" onClick={() => (window.location.hash = stockHref(symbol))}>
                      <td>
                        <a className="sym" href={stockHref(symbol)}>{symbol}</a>
                        <div className="sub ellipsis">{q?.name ?? (missing ? 'No data for this symbol' : '')}</div>
                      </td>
                      <td>
                        <Sparkline spark={sparks.data?.[symbol]} />
                      </td>
                      <td className="num strong">{fmtPrice(q?.price, q?.currency)}</td>
                      <td className="num">
                        <Delta change={q?.change} pct={q?.changePct} />
                      </td>
                      <td className="num">{fmtCompact(q?.volume)}</td>
                      <td className="num">{fmtCompact(q?.marketCap)}</td>
                      <td>
                        <RangeBar low={q?.week52Low} high={q?.week52High} value={q?.price} />
                      </td>
                      <td className="num">
                        <button
                          className="icon-btn"
                          aria-label={`Remove ${symbol} from watchlist`}
                          title="Remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemove(symbol);
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function RangeBar({ low, high, value }: { low?: number | null; high?: number | null; value?: number | null }) {
  if (low == null || high == null || value == null || high <= low) return <span className="sub">—</span>;
  const pos = Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
  return (
    <div className="range" title={`52-week low ${fmtPrice(low)} · high ${fmtPrice(high)}`}>
      <span className="range-end num">{fmtPrice(low)}</span>
      <span className="range-track">
        <span className="range-dot" style={{ left: `${pos}%` }} />
      </span>
      <span className="range-end num">{fmtPrice(high)}</span>
    </div>
  );
}
