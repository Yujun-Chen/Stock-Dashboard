import { useState } from 'react';
import { api, RANGES, type NewsItem, type Range } from '../api';
import { Delta } from '../components/Delta';
import { PageHead } from '../components/PageHead';
import { PriceChart } from '../components/PriceChart';
import { fmtCompact, fmtNumber, fmtPrice } from '../format';
import { usePolling } from '../hooks';
import { RangeBar } from './Watchlist';

interface Props {
  symbol: string;
  watched: boolean;
  onToggleWatch: (symbol: string) => void;
}

export function StockDetail({ symbol, watched, onToggleWatch }: Props) {
  const [range, setRange] = useState<Range>('1D');
  const quote = usePolling(`quote:${symbol}`, (signal) => api.quotes([symbol], signal), 30_000);
  const chart = usePolling(`chart:${symbol}:${range}`, (signal) => api.chart(symbol, range, signal), range === '1D' ? 60_000 : 0);
  const profile = usePolling(`profile:${symbol}`, (signal) => api.profile(symbol, signal));
  const news = usePolling(`news:${symbol}`, (signal) => api.news(symbol, signal), 5 * 60_000);
  // Today's bar is still moving during the session, so it is labelled "Today" rather than a close.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(Date.now());

  const q = quote.data?.[0];
  const chartData = chart.data && chart.data.range === range && chart.data.symbol === (q?.symbol ?? symbol) ? chart.data : undefined;

  if (!q && !quote.loading && !quote.error) {
    return (
      <>
        <PageHead title={symbol} />
        <div className="card empty">No data found for “{symbol}”. Check the symbol or try the search box.</div>
      </>
    );
  }

  // Change over the selected range, from the same series the chart plots.
  const last = chartData?.points.at(-1)?.c;
  const base = chartData?.baseline;
  const rangeChange = last != null && base ? last - base : null;
  const rangePct = rangeChange != null && base ? (rangeChange / base) * 100 : null;
  const showExt = q?.extPrice != null && q.marketState !== 'REGULAR' && q.extChangePct != null;
  const p = profile.data ?? {};

  const stats: [string, string][] = q
    ? [
        ['Open', fmtPrice(q.open)],
        ['Previous close', fmtPrice(q.prevClose)],
        ['Day range', q.dayLow != null && q.dayHigh != null ? `${fmtPrice(q.dayLow)} – ${fmtPrice(q.dayHigh)}` : '—'],
        ['Volume', fmtCompact(q.volume)],
        ['Avg. volume (3 mo)', fmtCompact(q.avgVolume)],
        ['Market cap', fmtCompact(q.marketCap)],
        ['P/E (trailing)', fmtNumber(q.pe)],
        ['P/E (forward)', fmtNumber(q.forwardPe)],
        ['EPS (trailing)', fmtNumber(q.eps)],
        ['Dividend yield', q.dividendYield != null ? `${fmtNumber(q.dividendYield)}%` : '—'],
        ['Beta', fmtNumber(p.beta)],
        [
          'Next earnings',
          q.earningsDate && q.earningsDate > Date.now() - 86_400_000
            ? new Date(q.earningsDate).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }) +
              (q.earningsEstimate ? ' (est.)' : '')
            : '—',
        ],
      ]
    : [];

  return (
    <>
      <PageHead
        title={
          <>
            {q?.longName ?? symbol} <span className="title-symbol">{symbol}</span>
          </>
        }
        subtitle={q ? [q.exchange, q.currency].filter(Boolean).join(' · ') : undefined}
        marketState={q?.marketState}
        updatedAt={quote.updatedAt}
        error={quote.error}
      >
        <button className="btn" onClick={() => onToggleWatch(symbol)} aria-pressed={watched}>
          {watched ? '★ In watchlist' : '☆ Add to watchlist'}
        </button>
      </PageHead>

      <section className="card">
        <div className="quote-head">
          <div>
            <div className="hero">{fmtPrice(q?.price, q?.currency)}</div>
            <div className="hero-sub">
              <Delta change={q?.change} pct={q?.changePct} /> <span className="sub">today</span>
              {showExt && (
                <span className="sub ext">
                  Extended hours {fmtPrice(q!.extPrice)} <Delta pct={q!.extChangePct} compact />
                </span>
              )}
            </div>
          </div>
          <div className="range-side">
            <div className="tabs" role="tablist" aria-label="Chart range">
              {RANGES.map((r) => (
                <button key={r} role="tab" aria-selected={r === range} className={r === range ? 'active' : ''} onClick={() => setRange(r)}>
                  {r}
                </button>
              ))}
            </div>
            {range !== '1D' && rangePct != null && (
              <div className="sub range-change">
                {range} change <Delta change={rangeChange} pct={rangePct} />
              </div>
            )}
          </div>
        </div>

        {chartData ? (
          <PriceChart data={chartData} />
        ) : (
          <div className="chart-empty">{chart.error ? `Couldn't load the chart: ${chart.error}` : 'Loading chart…'}</div>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Key statistics</h2>
          <dl className="stats">
            {stats.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="num">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="stat-range">
            <div className="sub">52-week range</div>
            <RangeBar low={q?.week52Low} high={q?.week52High} value={q?.price} />
          </div>
        </section>

        <section className="card">
          <h2>About</h2>
          {p.description ? (
            <>
              <p className="card-note">
                {[p.sector, p.industry, p.country, p.employees ? `${fmtCompact(p.employees)} employees` : null].filter(Boolean).join(' · ')}
              </p>
              <p className="about">{p.description}</p>
              {p.website && /^https?:\/\//.test(p.website) && (
                <a className="link" href={p.website} target="_blank" rel="noreferrer noopener">
                  {p.website.replace(/^https?:\/\//, '')}
                </a>
              )}
            </>
          ) : (
            <div className="empty">{profile.loading ? 'Loading…' : 'No company profile is available for this instrument.'}</div>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Recent news</h2>
        <p className="card-note">The past week, grouped by day, with {symbol}'s price for each trading day</p>
        {news.data?.length ? (
          [...new Set(news.data.map((n) => n.day))].map((day) => (
            <NewsDay key={day} day={day} isToday={day === today} items={news.data!.filter((n) => n.day === day)} />
          ))
        ) : (
          <div className="empty">{news.loading ? 'Loading…' : news.error ? `Couldn't load news: ${news.error}` : 'No recent news for this symbol.'}</div>
        )}
      </section>
    </>
  );
}

const NEWS_DAY_LIMIT = 5;

const newsDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
const newsTimeFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

function NewsDay({ day, isToday, items }: { day: string; isToday: boolean; items: NewsItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, NEWS_DAY_LIMIT);
  // Every story of the day carries the same price; it is absent on weekends and holidays.
  const price = items[0].price?.sameDay ? items[0].price : null;

  return (
    <div className="news-day">
      <div className="news-day-head">
        <div>
          <span className="strong">{isToday ? 'Today' : newsDayFmt.format(Date.parse(`${day}T00:00:00Z`))}</span>
          <span className="sub news-day-count">
            {items.length} {items.length === 1 ? 'story' : 'stories'}
          </span>
        </div>
        {price ? (
          <div className="news-day-price">
            <span className="sub">{isToday ? 'Price' : 'Closed at'}</span> <span className="strong num">{fmtPrice(price.close, price.currency)}</span>{' '}
            <Delta pct={price.changePct} compact />
          </div>
        ) : (
          <span className="sub">Market closed</span>
        )}
      </div>
      <ul className="news">
        {shown.map((n) => (
          <li key={n.id}>
            <a href={n.link} target="_blank" rel="noreferrer noopener">
              {n.title}
            </a>
            <div className="sub">
              {[n.publisher, n.time ? `${newsTimeFmt.format(n.time)} ET` : '', n.direct ? '' : 'Related market news'].filter(Boolean).join(' · ')}
            </div>
          </li>
        ))}
      </ul>
      {items.length > NEWS_DAY_LIMIT && (
        <button className="cal-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show ${items.length - NEWS_DAY_LIMIT} more`}
        </button>
      )}
    </div>
  );
}
