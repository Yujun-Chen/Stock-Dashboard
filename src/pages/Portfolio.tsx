import { useState } from 'react';
import { api } from '../api';
import { Delta } from '../components/Delta';
import { PageHead, stockHref } from '../components/PageHead';
import { SymbolSearch } from '../components/SymbolSearch';
import { fmtNumber, fmtPrice, fmtSigned } from '../format';
import { useLocalStorage, usePolling } from '../hooks';

interface Holding {
  symbol: string;
  shares: number;
  /** Average cost per share. */
  cost: number;
}

const MAX_SLICES = 7;

export function Portfolio() {
  const [holdings, setHoldings] = useLocalStorage<Holding[]>('portfolio.holdings', []);
  const symbols = holdings.map((h) => h.symbol);
  const quotes = usePolling(`pf:${symbols.join(',')}`, (signal) => api.quotes(symbols, signal), 30_000);
  const bySymbol = new Map((quotes.data ?? []).map((q) => [q.symbol, q]));

  const rows = holdings.map((h) => {
    const q = bySymbol.get(h.symbol);
    const price = q?.price ?? null;
    const value = price != null ? price * h.shares : null;
    const basis = h.cost * h.shares;
    return {
      ...h,
      name: q?.name,
      price,
      value,
      basis,
      dayChange: q?.change != null ? q.change * h.shares : null,
      dayPct: q?.changePct ?? null,
      gain: value != null ? value - basis : null,
      gainPct: value != null && basis > 0 ? ((value - basis) / basis) * 100 : null,
    };
  });

  const priced = rows.filter((r) => r.value != null);
  const totalValue = priced.reduce((s, r) => s + r.value!, 0);
  const totalBasis = priced.reduce((s, r) => s + r.basis, 0);
  const dayChange = priced.reduce((s, r) => s + (r.dayChange ?? 0), 0);
  const prevValue = totalValue - dayChange;
  const totalGain = totalValue - totalBasis;

  const sorted = [...priced].sort((a, b) => b.value! - a.value!);
  const slices = sorted.slice(0, MAX_SLICES).map((r, i) => ({ label: r.symbol, value: r.value!, slot: `var(--series-${i + 1})` }));
  const rest = sorted.slice(MAX_SLICES).reduce((s, r) => s + r.value!, 0);
  if (rest > 0) slices.push({ label: 'Other', value: rest, slot: 'var(--text-muted)' });

  const add = (h: Holding) =>
    setHoldings((prev) => {
      const existing = prev.find((p) => p.symbol === h.symbol);
      if (!existing) return [...prev, h];
      const shares = existing.shares + h.shares;
      const cost = (existing.cost * existing.shares + h.cost * h.shares) / shares;
      return prev.map((p) => (p.symbol === h.symbol ? { symbol: h.symbol, shares, cost } : p));
    });
  const remove = (symbol: string) => setHoldings((prev) => prev.filter((p) => p.symbol !== symbol));

  const has = holdings.length > 0;

  return (
    <>
      <PageHead
        title="Portfolio"
        subtitle="Holdings are saved in this browser only"
        marketState={quotes.data?.[0]?.marketState}
        updatedAt={has ? quotes.updatedAt : null}
        error={quotes.error}
      />

      {has && (
        <div className="tiles tiles-4">
          <div className="card tile">
            <div className="tile-label">Total value</div>
            <div className="tile-value">{fmtPrice(totalValue, 'USD')}</div>
          </div>
          <div className="card tile">
            <div className="tile-label">Today's change</div>
            <div className="tile-value">{fmtSigned(dayChange, 'USD')}</div>
            <div className="tile-foot">
              <Delta pct={prevValue > 0 ? (dayChange / prevValue) * 100 : 0} compact />
            </div>
          </div>
          <div className="card tile">
            <div className="tile-label">Total gain / loss</div>
            <div className="tile-value">{fmtSigned(totalGain, 'USD')}</div>
            <div className="tile-foot">
              <Delta pct={totalBasis > 0 ? (totalGain / totalBasis) * 100 : 0} compact />
            </div>
          </div>
          <div className="card tile">
            <div className="tile-label">Cost basis</div>
            <div className="tile-value">{fmtPrice(totalBasis, 'USD')}</div>
          </div>
        </div>
      )}

      {slices.length > 1 && totalValue > 0 && (
        <section className="card">
          <h2>Allocation</h2>
          <p className="card-note">Share of total portfolio value</p>
          <div className="alloc-bar" role="img" aria-label={slices.map((s) => `${s.label} ${((s.value / totalValue) * 100).toFixed(1)}%`).join(', ')}>
            {slices.map((s) => (
              <span
                key={s.label}
                style={{ flexGrow: s.value, background: s.slot }}
                title={`${s.label}: ${fmtPrice(s.value, 'USD')} (${((s.value / totalValue) * 100).toFixed(1)}%)`}
              />
            ))}
          </div>
          <ul className="legend">
            {slices.map((s) => (
              <li key={s.label}>
                <span className="swatch" style={{ background: s.slot }} />
                <span className="strong">{s.label}</span>
                <span className="num">{((s.value / totalValue) * 100).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card card-flush">
        <div className="card-pad">
          <h2>Holdings</h2>
          <AddHolding onAdd={add} />
        </div>
        {!has ? (
          <div className="empty">No holdings yet. Add a symbol, the number of shares and what you paid per share.</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num">Shares</th>
                  <th className="num">Avg. cost</th>
                  <th className="num">Price</th>
                  <th className="num">Value</th>
                  <th className="num">Today</th>
                  <th className="num">Total gain / loss</th>
                  <th className="num">Weight</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol} className="row-link" onClick={() => (window.location.hash = stockHref(r.symbol))}>
                    <td>
                      <a className="sym" href={stockHref(r.symbol)}>{r.symbol}</a>
                      <div className="sub ellipsis">{r.name ?? (quotes.loading ? '' : 'No data for this symbol')}</div>
                    </td>
                    <td className="num">{fmtNumber(r.shares, r.shares % 1 ? 4 : 0)}</td>
                    <td className="num">{fmtPrice(r.cost)}</td>
                    <td className="num">{fmtPrice(r.price)}</td>
                    <td className="num strong">{fmtPrice(r.value)}</td>
                    <td className="num">
                      <Delta change={r.dayChange} pct={r.dayPct} />
                    </td>
                    <td className="num">
                      <Delta change={r.gain} pct={r.gainPct} />
                    </td>
                    <td className="num">{r.value != null && totalValue > 0 ? `${((r.value / totalValue) * 100).toFixed(1)}%` : '—'}</td>
                    <td className="num">
                      <button
                        className="icon-btn"
                        aria-label={`Remove ${r.symbol} from portfolio`}
                        title="Remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(r.symbol);
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {has && <p className="footnote">Totals assume every holding is priced in US dollars.</p>}
    </>
  );
}

function AddHolding({ onAdd }: { onAdd: (h: Holding) => void }) {
  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [cost, setCost] = useState('');
  const [formKey, setFormKey] = useState(0);

  const nShares = Number(shares);
  const nCost = Number(cost);
  const valid = /^[A-Z0-9.\-=^]{1,15}$/.test(symbol) && nShares > 0 && cost !== '' && nCost >= 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onAdd({ symbol, shares: nShares, cost: nCost });
    setSymbol('');
    setShares('');
    setCost('');
    setFormKey((k) => k + 1); // remount the search box to clear it
  };

  return (
    <form className="add-form" onSubmit={submit}>
      <label>
        <span>Symbol</span>
        <SymbolSearch key={formKey} keepValue onSelect={setSymbol} placeholder="e.g. AAPL" ariaLabel="Symbol" />
      </label>
      <label>
        <span>Shares</span>
        <input type="number" inputMode="decimal" min="0" step="any" value={shares} onChange={(e) => setShares(e.target.value)} placeholder="10" />
      </label>
      <label>
        <span>Cost per share</span>
        <input type="number" inputMode="decimal" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="150.00" />
      </label>
      <button className="btn primary" type="submit" disabled={!valid}>
        Add holding
      </button>
    </form>
  );
}
