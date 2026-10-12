import { api, type Quote } from '../api';
import { Delta } from '../components/Delta';
import { PageHead, stockHref } from '../components/PageHead';
import { Sparkline } from '../components/Sparkline';
import { direction, fmtCompact, fmtPct, fmtPrice } from '../format';
import { usePolling } from '../hooks';

const INDICES: [string, string][] = [
  ['^GSPC', 'S&P 500'],
  ['^IXIC', 'Nasdaq Composite'],
  ['^DJI', 'Dow Jones'],
  ['^RUT', 'Russell 2000'],
  ['^VIX', 'VIX volatility'],
];

const OTHER: [string, string][] = [
  ['^TNX', '10-year Treasury yield'],
  ['DX-Y.NYB', 'US Dollar index'],
  ['EURUSD=X', 'EUR / USD'],
  ['GC=F', 'Gold'],
  ['CL=F', 'Crude oil (WTI)'],
  ['BTC-USD', 'Bitcoin'],
];

const SECTORS: [string, string][] = [
  ['XLK', 'Technology'],
  ['XLC', 'Communication Services'],
  ['XLY', 'Consumer Discretionary'],
  ['XLF', 'Financials'],
  ['XLV', 'Health Care'],
  ['XLI', 'Industrials'],
  ['XLP', 'Consumer Staples'],
  ['XLE', 'Energy'],
  ['XLB', 'Materials'],
  ['XLU', 'Utilities'],
  ['XLRE', 'Real Estate'],
];

const ALL = [...INDICES, ...OTHER, ...SECTORS].map(([s]) => s);
const INDEX_SYMBOLS = INDICES.map(([s]) => s);

export function Overview() {
  const quotes = usePolling('overview', (signal) => api.quotes(ALL, signal), 30_000);
  const sparks = usePolling('overview-sparks', (signal) => api.sparks(INDEX_SYMBOLS, signal), 120_000);
  const movers = usePolling('movers', (signal) => api.movers(signal), 60_000);

  const bySymbol = new Map((quotes.data ?? []).map((q) => [q.symbol, q]));
  const sectors = SECTORS.map(([symbol, label]) => ({ symbol, label, pct: bySymbol.get(symbol)?.changePct ?? null }))
    .filter((s): s is { symbol: string; label: string; pct: number } => s.pct != null)
    .sort((a, b) => b.pct - a.pct);
  const sectorMax = Math.max(0.5, ...sectors.map((s) => Math.abs(s.pct)));

  return (
    <>
      <PageHead
        title="Market overview"
        subtitle="US indices, sectors and today's biggest movers"
        marketState={bySymbol.get('^GSPC')?.marketState}
        updatedAt={quotes.updatedAt}
        error={quotes.error}
      />

      <div className="tiles">
        {INDICES.map(([symbol, label]) => {
          const q = bySymbol.get(symbol);
          return (
            <a className="card tile" key={symbol} href={stockHref(symbol)}>
              <div className="tile-top">
                <span className="tile-label">{label}</span>
                <Sparkline spark={sparks.data?.[symbol]} width={64} height={22} />
              </div>
              <div className="tile-value">{q ? fmtPrice(q.price) : '—'}</div>
              <div className="tile-foot">
                <Delta change={q?.change} pct={q?.changePct} />
              </div>
            </a>
          );
        })}
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Sector performance</h2>
          <p className="card-note">Today's change, by SPDR sector ETF</p>
          {sectors.length === 0 ? (
            <div className="empty">{quotes.loading ? 'Loading…' : 'No sector data.'}</div>
          ) : (
            <div className="sectors">
              {sectors.map((s) => {
                const width = (Math.abs(s.pct) / sectorMax) * 50;
                const dir = direction(s.pct);
                return (
                  <a className="sector-row" key={s.symbol} href={stockHref(s.symbol)} title={`${s.label} (${s.symbol}) ${fmtPct(s.pct)}`}>
                    <span className="sector-label">{s.label}</span>
                    <span className="sector-track">
                      <span
                        className={`sector-bar ${dir}`}
                        style={dir === 'down' ? { right: '50%', width: `${width}%` } : { left: '50%', width: `${width}%` }}
                      />
                    </span>
                    <span className="sector-value num">{fmtPct(s.pct)}</span>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Rates, currencies and commodities</h2>
          <p className="card-note">Latest price and today's change</p>
          <table className="table">
            <tbody>
              {OTHER.map(([symbol, label]) => {
                const q = bySymbol.get(symbol);
                return (
                  <tr key={symbol} className="row-link" onClick={() => (window.location.hash = stockHref(symbol))}>
                    <td>
                      <a href={stockHref(symbol)}>{label}</a>
                    </td>
                    <td className="num">{q ? fmtPrice(q.price) : '—'}</td>
                    <td className="num">
                      <Delta pct={q?.changePct} compact />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid-3">
        <MoverList title="Top gainers" quotes={movers.data?.gainers} loading={movers.loading} />
        <MoverList title="Top losers" quotes={movers.data?.losers} loading={movers.loading} />
        <MoverList title="Most active" quotes={movers.data?.actives} loading={movers.loading} showVolume />
      </div>
    </>
  );
}

function MoverList({ title, quotes, loading, showVolume }: { title: string; quotes?: Quote[]; loading: boolean; showVolume?: boolean }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {!quotes?.length ? (
        <div className="empty">{loading ? 'Loading…' : 'Nothing to show right now.'}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="num">{showVolume ? 'Volume' : 'Price'}</th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.symbol} className="row-link" onClick={() => (window.location.hash = stockHref(q.symbol))}>
                <td>
                  <a className="sym" href={stockHref(q.symbol)}>{q.symbol}</a>
                  <div className="sub ellipsis">{q.name}</div>
                </td>
                <td className="num">{showVolume ? fmtCompact(q.volume) : fmtPrice(q.price)}</td>
                <td className="num">
                  <Delta pct={q.changePct} compact />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
