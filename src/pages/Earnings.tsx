import { useMemo, useState } from 'react';
import { api, type EarningsItem, type IndexId } from '../api';
import { PageHead, stockHref } from '../components/PageHead';
import { fmtCompact } from '../format';
import { useLocalStorage, usePolling } from '../hooks';

type Filter = 'all' | IndexId;

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['sp500', 'S&P 500'],
  ['ndx', 'Nasdaq-100'],
  ['dow', 'Dow 30'],
];

const SESSIONS = ['Before open', 'During market hours', 'After close'] as const;
const DAY_LIMIT = 10;
const DAY_MS = 86_400_000;

// Earnings dates are grouped by the New York calendar day and trading session.
const nyParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function nyDayAndSession(t: number): { day: string; session: number } {
  const p = Object.fromEntries(nyParts.formatToParts(t).map((x) => [x.type, x.value]));
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  return { day: `${p.year}-${p.month}-${p.day}`, session: minutes < 570 ? 0 : minutes < 960 ? 1 : 2 };
}

// Day keys are YYYY-MM-DD strings; do the arithmetic in UTC so it never shifts.
const keyToUtc = (key: string) => Date.parse(`${key}T00:00:00Z`);
const utcToKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (key: string, n: number) => utcToKey(keyToUtc(key) + n * DAY_MS);
const mondayOf = (key: string) => addDays(key, -((new Date(keyToUtc(key)).getUTCDay() + 6) % 7));
const fmtKey = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(keyToUtc(key));

interface Props {
  watchlist: string[];
}

export function Earnings({ watchlist }: Props) {
  const earnings = usePolling('earnings', (signal) => api.earnings(signal), 15 * 60_000);
  const [filter, setFilter] = useLocalStorage<Filter>('earnings.filter', 'all');
  const [watchOnly, setWatchOnly] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const watched = useMemo(() => new Set(watchlist), [watchlist]);

  const today = nyDayAndSession(Date.now()).day;
  // On a weekend the calendar opens on the coming week.
  const weekday = new Date(keyToUtc(today)).getUTCDay();
  const firstWeek = mondayOf(weekday === 6 ? addDays(today, 2) : weekday === 0 ? addDays(today, 1) : today);

  const byDay = useMemo(() => {
    const map = new Map<string, (EarningsItem & { session: number })[]>();
    for (const item of earnings.data?.items ?? []) {
      if (filter !== 'all' && !item.indices.includes(filter)) continue;
      if (watchOnly && !watched.has(item.symbol)) continue;
      const { day, session } = nyDayAndSession(item.date);
      if (day < today) continue;
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push({ ...item, session });
    }
    for (const list of map.values()) list.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    return map;
  }, [earnings.data, filter, watchOnly, watched, today]);

  const lastDay = [...byDay.keys()].sort().at(-1);
  const maxOffset = lastDay ? Math.max(0, Math.round((keyToUtc(mondayOf(lastDay)) - keyToUtc(firstWeek)) / (7 * DAY_MS))) : 0;
  const offset = Math.min(weekOffset, maxOffset);
  const monday = addDays(firstWeek, offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d, i) => i < 5 || byDay.has(d));
  const weekTotal = days.reduce((n, d) => n + (byDay.get(d)?.length ?? 0), 0);
  const counts = earnings.data?.counts;

  return (
    <>
      <PageHead
        title="Earnings calendar"
        subtitle="Upcoming report dates for S&P 500, Nasdaq-100 and Dow 30 companies"
        updatedAt={earnings.updatedAt}
        error={earnings.error}
      />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Index">
          {FILTERS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={id === filter} className={id === filter ? 'active' : ''} onClick={() => setFilter(id)}>
              {label}
              {id !== 'all' && counts ? <span className="tab-count">{counts[id]}</span> : null}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} />
          Watchlist only
        </label>
        <div className="week-nav">
          <button className="btn" onClick={() => setWeekOffset(offset - 1)} disabled={offset === 0} aria-label="Previous week">
            ←
          </button>
          <div className="week-label">
            <span className="strong">
              {fmtKey(monday, { month: 'short', day: 'numeric' })} – {fmtKey(addDays(monday, 4), { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="sub">
              {weekTotal} {weekTotal === 1 ? 'report' : 'reports'}
            </span>
          </div>
          <button className="btn" onClick={() => setWeekOffset(offset + 1)} disabled={offset >= maxOffset} aria-label="Next week">
            →
          </button>
        </div>
      </div>

      {!earnings.data ? (
        <div className="card empty">{earnings.error ? 'The earnings calendar could not be loaded.' : 'Loading earnings dates for about 500 companies…'}</div>
      ) : (
        <div className="cal">
          {days.map((day) => (
            <DayColumn key={`${day}:${filter}:${watchOnly}`} day={day} isToday={day === today} items={byDay.get(day) ?? []} watched={watched} />
          ))}
        </div>
      )}

      <p className="footnote">
        Each day shows its ten largest companies first, ordered by market value within each session. “est.” marks a date the company has not confirmed yet. Times are US Eastern; index membership comes from
        Wikipedia's component lists.
      </p>
    </>
  );
}

function DayColumn({ day, isToday, items, watched }: { day: string; isToday: boolean; items: (EarningsItem & { session: number })[]; watched: Set<string> }) {
  const [expanded, setExpanded] = useState(false);
  // Items arrive ordered by market value; the cut keeps the largest companies.
  const shown = expanded ? items : items.slice(0, DAY_LIMIT);
  const hidden = items.length - shown.length;

  return (
    <section className={`card cal-day ${isToday ? 'today' : ''}`}>
      <header className="cal-head">
        <div>
          <span className="strong">{fmtKey(day, { weekday: 'short' })}</span> <span className="sub">{fmtKey(day, { month: 'short', day: 'numeric' })}</span>
          {isToday && <span className="cal-today">Today</span>}
        </div>
        <span className="sub num">{items.length || ''}</span>
      </header>
      {items.length === 0 ? (
        <div className="cal-none">No reports</div>
      ) : (
        SESSIONS.map((label, session) => {
          const group = shown.filter((it) => it.session === session);
          if (!group.length) return null;
          return (
            <div key={label} className="cal-group">
              <div className="cal-session">{label}</div>
              {group.map((it) => (
                <a key={it.symbol} className="cal-item" href={stockHref(it.symbol)} title={`${it.name} · market cap ${fmtCompact(it.marketCap)}`}>
                  <span className="sym">
                    {watched.has(it.symbol) && <span className="cal-star" aria-label="In watchlist">★</span>}
                    {it.symbol}
                  </span>
                  <span className="cal-name">{it.name}</span>
                  {it.estimate && <span className="cal-est">est.</span>}
                </a>
              ))}
            </div>
          );
        })
      )}
      {(hidden > 0 || expanded) && items.length > DAY_LIMIT && (
        <button className="cal-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </section>
  );
}
