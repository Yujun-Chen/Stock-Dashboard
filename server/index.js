import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YahooFinance from 'yahoo-finance2';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
const port = Number(process.env.PORT) || 5173;

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// ---------- tiny TTL cache (also de-duplicates in-flight requests) ----------
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = fn().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { exp: Date.now() + ttlMs, value });
  return value;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (v.exp <= now) cache.delete(k);
}, 60_000).unref();

// ---------- helpers ----------
const SYMBOL_RE = /^[A-Za-z0-9.\-=^]{1,15}$/;

function parseSymbols(raw) {
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SYMBOL_RE.test(s));
  return [...new Set(list)].slice(0, 60);
}

const toMs = (d) => (d ? new Date(d).getTime() : null);

function trimQuote(q) {
  return {
    symbol: q.symbol,
    name: q.shortName ?? q.longName ?? q.symbol,
    longName: q.longName ?? q.shortName ?? q.symbol,
    type: q.quoteType,
    exchange: q.fullExchangeName,
    currency: q.currency ?? 'USD',
    marketState: q.marketState,
    time: q.regularMarketTime ? new Date(q.regularMarketTime).getTime() : null,
    price: q.regularMarketPrice ?? null,
    change: q.regularMarketChange ?? null,
    changePct: q.regularMarketChangePercent ?? null,
    prevClose: q.regularMarketPreviousClose ?? null,
    open: q.regularMarketOpen ?? null,
    dayHigh: q.regularMarketDayHigh ?? null,
    dayLow: q.regularMarketDayLow ?? null,
    volume: q.regularMarketVolume ?? null,
    avgVolume: q.averageDailyVolume3Month ?? null,
    marketCap: q.marketCap ?? null,
    pe: q.trailingPE ?? null,
    forwardPe: q.forwardPE ?? null,
    eps: q.epsTrailingTwelveMonths ?? null,
    dividendYield: q.dividendYield ?? null,
    week52High: q.fiftyTwoWeekHigh ?? null,
    week52Low: q.fiftyTwoWeekLow ?? null,
    extPrice: q.postMarketPrice ?? q.preMarketPrice ?? null,
    extChangePct: q.postMarketChangePercent ?? q.preMarketChangePercent ?? null,
    earningsDate: toMs(q.earningsTimestampStart ?? q.earningsTimestamp),
    earningsEstimate: Boolean(q.isEarningsDateEstimate),
  };
}

const DAY = 86_400_000;
const RANGES = {
  '1D': { back: 5 * DAY, interval: '5m', sessions: 1 },
  '5D': { back: 9 * DAY, interval: '30m', sessions: 5 },
  '1M': { back: 31 * DAY, interval: '1d' },
  '6M': { back: 183 * DAY, interval: '1d' },
  YTD: { ytd: true, interval: '1d' },
  '1Y': { back: 366 * DAY, interval: '1d' },
  '5Y': { back: 5 * 366 * DAY, interval: '1wk' },
  MAX: { max: true, interval: '1mo' },
};

async function loadChart(symbol, rangeKey, intervalOverride) {
  const range = RANGES[rangeKey];
  const now = Date.now();
  const period1 = range.max
    ? new Date('1970-01-02')
    : range.ytd
      ? new Date(Date.UTC(new Date().getUTCFullYear() - 1, 11, 25))
      : new Date(now - range.back);
  const res = await yf.chart(symbol, { period1, interval: intervalOverride ?? range.interval, includePrePost: false });
  const meta = res.meta ?? {};
  const offsetMs = (meta.gmtoffset ?? 0) * 1000;
  const lastRegular = meta.regularMarketTime ? new Date(meta.regularMarketTime).getTime() : Infinity;
  const localDay = (t) => new Date(t + offsetMs).toISOString().slice(0, 10);

  let points = (res.quotes ?? [])
    .filter((q) => q.close != null)
    .map((q) => ({ t: new Date(q.date).getTime(), c: q.close, v: q.volume ?? 0 }));

  let baseline = null;
  if (range.sessions) {
    // Drop the stray after-hours tick Yahoo appends, then keep the last N sessions.
    points = points.filter((p) => p.t <= lastRegular);
    const days = [...new Set(points.map((p) => localDay(p.t)))];
    const keep = new Set(days.slice(-range.sessions));
    const before = points.filter((p) => !keep.has(localDay(p.t)));
    baseline = before.length ? before[before.length - 1].c : null;
    points = points.filter((p) => keep.has(localDay(p.t)));
  } else if (range.ytd) {
    const year = String(new Date().getUTCFullYear());
    const before = points.filter((p) => localDay(p.t).slice(0, 4) < year);
    baseline = before.length ? before[before.length - 1].c : null;
    points = points.filter((p) => localDay(p.t).slice(0, 4) >= year);
  }
  if (baseline == null && points.length) baseline = points[0].c;

  return {
    symbol: meta.symbol ?? symbol,
    range: rangeKey,
    intraday: Boolean(range.sessions),
    currency: meta.currency ?? 'USD',
    timezone: meta.exchangeTimezoneName ?? 'America/New_York',
    baseline,
    points,
  };
}

// ---------- API ----------
const app = express();
app.disable('x-powered-by');
const api = express.Router();

api.get('/quotes', async (req, res) => {
  const symbols = parseSymbols(req.query.symbols);
  if (!symbols.length) return res.json([]);
  const key = `q:${[...symbols].sort().join(',')}`;
  const quotes = await cached(key, 15_000, async () => {
    const out = await yf.quote(symbols);
    return (Array.isArray(out) ? out : [out]).filter(Boolean).map(trimQuote);
  });
  res.json(quotes);
});

api.get('/sparks', async (req, res) => {
  const symbols = parseSymbols(req.query.symbols);
  const entries = await Promise.all(
    symbols.map(async (s) => {
      try {
        const c = await cached(`spark:${s}`, 120_000, () => loadChart(s, '1D', '15m'));
        return [s, { baseline: c.baseline, closes: c.points.map((p) => p.c) }];
      } catch {
        return [s, null];
      }
    }),
  );
  res.json(Object.fromEntries(entries));
});

api.get('/chart/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  const range = String(req.query.range ?? '1D').toUpperCase();
  if (!SYMBOL_RE.test(symbol) || !RANGES[range]) return res.status(400).json({ error: 'Bad symbol or range' });
  const ttl = RANGES[range].sessions ? 60_000 : 10 * 60_000;
  res.json(await cached(`chart:${symbol}:${range}`, ttl, () => loadChart(symbol, range)));
});

api.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 40);
  if (!q) return res.json([]);
  const results = await cached(`search:${q.toLowerCase()}`, 5 * 60_000, async () => {
    const out = await yf.search(q, { quotesCount: 8, newsCount: 0 });
    return (out.quotes ?? [])
      .filter((x) => x.symbol && SYMBOL_RE.test(x.symbol))
      .map((x) => ({
        symbol: x.symbol,
        name: x.shortname ?? x.longname ?? x.symbol,
        type: x.typeDisp ?? x.quoteType ?? '',
        exchange: x.exchDisp ?? '',
      }));
  });
  res.json(results);
});

api.get('/movers', async (_req, res) => {
  const lists = await cached('movers', 60_000, async () => {
    const ids = { gainers: 'day_gainers', losers: 'day_losers', actives: 'most_actives' };
    const out = {};
    await Promise.all(
      Object.entries(ids).map(async ([name, scrIds]) => {
        // Yahoo's screener fails now and then; one bad list shouldn't blank the other two.
        const r = await yf.screener({ scrIds, count: 8 }).catch((err) => {
          console.error('[movers]', name, String(err?.message ?? err).slice(0, 120));
          return null;
        });
        out[name] = (r?.quotes ?? []).slice(0, 8).map(trimQuote);
      }),
    );
    return out;
  });
  res.json(lists);
});

api.get('/profile/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Bad symbol' });
  const profile = await cached(`profile:${symbol}`, 60 * 60_000, async () => {
    try {
      const r = await yf.quoteSummary(symbol, { modules: ['assetProfile', 'summaryDetail'] });
      const p = r.assetProfile ?? {};
      return {
        sector: p.sector ?? null,
        industry: p.industry ?? null,
        website: p.website ?? null,
        employees: p.fullTimeEmployees ?? null,
        country: p.country ?? null,
        description: p.longBusinessSummary ?? null,
        beta: r.summaryDetail?.beta ?? null,
      };
    } catch {
      return {}; // indices, futures and FX have no profile
    }
  });
  res.json(profile);
});

const GENERIC_NAME_WORDS = new Set(['the', 'first', 'american', 'general', 'united', 'national', 'international', 'new', 'global']);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The distinctive start of a company name: "Apple", "NVIDIA", "JP Morgan". Empty if there is none. */
function nameKey(name) {
  const words = String(name ?? '').replace(/[,.]/g, '').split(/\s+/).filter(Boolean);
  let key = words[0] ?? '';
  if (key.length < 4 || GENERIC_NAME_WORDS.has(key.toLowerCase())) key = words.slice(0, 2).join(' ');
  return key.length >= 4 ? key : '';
}

/** Returns a test for whether a headline names this company or its ticker. */
function headlineMatcher(symbol, name) {
  const patterns = [];
  // Short tickers (T, C, GS) are ordinary words, so only accept them in brackets.
  patterns.push(symbol.length >= 3 ? new RegExp(`\\b${escapeRe(symbol)}\\b`) : new RegExp(`\\(${escapeRe(symbol)}\\)`));
  const key = nameKey(name);
  if (key) patterns.push(new RegExp(`\\b${escapeRe(key).replace(/ /g, '\\s*')}`, 'i'));
  return (title) => patterns.some((p) => p.test(title));
}

const NEWS_DAYS = 7;
const NEWS_PER_DAY = 15;

const decodeXml = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();

// Yahoo only returns the last day or two of stories, so the rest of the week comes from Google News.
async function googleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${NEWS_DAYS}d`)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Google News responded ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const tag = (name) => decodeXml(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '');
    const publisher = tag('source');
    const link = tag('link');
    const time = Date.parse(tag('pubDate'));
    // Titles arrive as "Headline - Publisher".
    let title = tag('title');
    if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -publisher.length - 3);
    if (!title || !Number.isFinite(time) || !link.startsWith('https://news.google.com/')) return [];
    return [{ id: tag('guid') || link, title, publisher, link, time }];
  });
}

const titleKey = (title) => title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);

function loadNews(symbol) {
  return cached(`news:${symbol}`, 5 * 60_000, async () => {
    const quote = await yf.quote(symbol).catch(() => null);
    const name = quote?.shortName ?? quote?.longName;
    const key = nameKey(name);
    const [yahoo, google] = await Promise.all([
      yf.search(symbol, { quotesCount: 0, newsCount: 40 }).catch(() => null),
      googleNews(key ? `"${key}" ${symbol}` : `${symbol} stock`).catch((err) => {
        console.error('[news] google', symbol, err?.message ?? err);
        return [];
      }),
    ]);
    if (!yahoo && !google.length) throw new Error('No news source responded');

    const yahooItems = (yahoo?.news ?? [])
      .filter((n) => n.title && /^https?:\/\//.test(n.link ?? ''))
      .map((n) => ({ id: n.uuid ?? n.link, title: n.title, publisher: n.publisher ?? '', link: n.link, time: toMs(n.providerPublishTime) }));

    // Both sources return loosely related stories, so a headline that names the
    // company or ticker is the only dependable sign a story is about it.
    const mentions = headlineMatcher(symbol, name);
    const cutoff = Date.now() - NEWS_DAYS * DAY;
    const seen = new Set();
    const all = [...yahooItems, ...google]
      .filter((n) => n.time && n.time >= cutoff)
      .filter((n) => {
        const k = titleKey(n.title);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((n) => ({ ...n, direct: mentions(n.title) }));

    let items = all.filter((n) => n.direct);
    // Thinly covered symbols: pad with Yahoo's related stories rather than show almost nothing.
    if (items.length < 5) items = [...items, ...all.filter((n) => !n.direct).slice(0, 6 - items.length)];

    const lookup = await dailyPriceLookup(symbol, items).catch(() => null);
    const perDay = new Map();
    return items
      .sort((a, b) => b.time - a.time)
      .map((n) => ({ ...n, day: lookup?.dayOf(n.time) ?? new Date(n.time - 4 * 3_600_000).toISOString().slice(0, 10), price: lookup?.priceOn(n.time) ?? null }))
      .filter((n) => {
        perDay.set(n.day, (perDay.get(n.day) ?? 0) + 1);
        return perDay.get(n.day) <= NEWS_PER_DAY;
      });
  });
}

/**
 * Returns lookups from a timestamp to its calendar day on the stock's exchange
 * and to the stock's daily close on that day. Weekends and holidays resolve to
 * the last trading day before them.
 */
async function dailyPriceLookup(symbol, items) {
  const times = items.map((n) => n.time).filter(Boolean);
  if (!times.length) return null;
  const res = await yf.chart(symbol, { period1: new Date(Math.min(...times) - 10 * DAY), interval: '1d' });
  const offsetMs = (res.meta?.gmtoffset ?? 0) * 1000;
  const localDay = (t) => new Date(t + offsetMs).toISOString().slice(0, 10);
  const bars = (res.quotes ?? []).filter((q) => q.close != null).map((q) => ({ day: localDay(new Date(q.date).getTime()), close: q.close }));
  const priceOn = (time) => {
    const newsDay = localDay(time);
    const i = bars.findLastIndex((b) => b.day <= newsDay);
    if (i < 0) return null;
    const prev = bars[i - 1]?.close;
    return {
      day: bars[i].day,
      close: bars[i].close,
      changePct: prev ? ((bars[i].close - prev) / prev) * 100 : null,
      sameDay: bars[i].day === newsDay,
      currency: res.meta?.currency ?? 'USD',
    };
  };
  return { dayOf: localDay, priceOn };
}

api.get('/news/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Bad symbol' });
  res.json(await loadNews(symbol));
});

// Sector and industry per symbol, for grouping the watchlist.
api.get('/sectors', async (req, res) => {
  const symbols = parseSymbols(req.query.symbols);
  const entries = await Promise.all(
    symbols.map(async (s) => {
      try {
        const info = await cached(`sector:${s}`, 24 * 60 * 60_000, async () => {
          const r = await yf.quoteSummary(s, { modules: ['assetProfile'] });
          return { sector: r.assetProfile?.sector ?? null, industry: r.assetProfile?.industry ?? null };
        });
        return [s, info];
      } catch {
        return [s, { sector: null, industry: null }]; // ETFs, indices and FX have no profile
      }
    }),
  );
  res.json(Object.fromEntries(entries));
});

// ---------- earnings calendar ----------
// Index membership comes from Wikipedia's component lists, refreshed daily.
const INDEX_PAGES = {
  sp500: 'List_of_S%26P_500_companies',
  ndx: 'List_of_NASDAQ-100_companies',
  dow: 'List_of_Dow_Jones_Industrial_Average_companies',
};
const lastGoodConstituents = {};

const stripHtml = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<sup[\s\S]*?<\/sup>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#160;|&nbsp;/g, ' ')
    .trim();
const rowCells = (row) => [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => stripHtml(c[1]));

async function fetchConstituents(page) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=text&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'stock-dashboard/1.0 (local personal dashboard)' } });
  if (!res.ok) throw new Error(`Wikipedia responded ${res.status}`);
  const html = (await res.json())?.parse?.text ?? '';
  // The component table is the largest one with a Symbol/Ticker column.
  let best = [];
  for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    const rows = table.split(/<tr[^>]*>/).slice(1);
    const col = rowCells(rows[0] ?? '').findIndex((h) => /^(symbol|ticker)/i.test(h));
    if (col < 0) continue;
    const symbols = rows
      .slice(1)
      .map((r) => (rowCells(r)[col] ?? '').replace(/^.*:\s*/, ''))
      .filter((sym) => /^[A-Z][A-Z.]{0,5}$/.test(sym))
      .map((sym) => sym.replace('.', '-')); // Yahoo writes BRK.B as BRK-B
    if (symbols.length > best.length) best = symbols;
  }
  if (best.length < 20) throw new Error('Could not read the index component list');
  return best;
}

function loadConstituents() {
  return cached('constituents', 24 * 60 * 60_000, async () => {
    const out = {};
    await Promise.all(
      Object.entries(INDEX_PAGES).map(async ([id, page]) => {
        try {
          lastGoodConstituents[id] = await fetchConstituents(page);
        } catch (err) {
          console.error('[constituents]', id, err?.message ?? err);
          if (!lastGoodConstituents[id]) throw err;
        }
        out[id] = lastGoodConstituents[id];
      }),
    );
    return out;
  });
}

api.get('/earnings', async (_req, res) => {
  const data = await cached('earnings', 15 * 60_000, async () => {
    const lists = await loadConstituents();
    const membership = new Map();
    for (const [id, symbols] of Object.entries(lists)) {
      for (const sym of symbols) membership.set(sym, [...(membership.get(sym) ?? []), id]);
    }
    const symbols = [...membership.keys()];
    const chunks = [];
    for (let i = 0; i < symbols.length; i += 100) chunks.push(symbols.slice(i, i + 100));
    const quotes = (await Promise.all(chunks.map((c) => yf.quote(c)))).flat().filter(Boolean);

    const cutoff = Date.now() - DAY;
    const items = quotes
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortName ?? q.longName ?? q.symbol,
        indices: membership.get(q.symbol) ?? [],
        date: toMs(q.earningsTimestampStart ?? q.earningsTimestamp),
        dateEnd: toMs(q.earningsTimestampEnd),
        estimate: Boolean(q.isEarningsDateEstimate),
        marketCap: q.marketCap ?? null,
      }))
      .filter((it) => it.date != null && it.date >= cutoff)
      .sort((a, b) => a.date - b.date || (b.marketCap ?? 0) - (a.marketCap ?? 0));

    return {
      asOf: Date.now(),
      counts: Object.fromEntries(Object.entries(lists).map(([id, l]) => [id, l.length])),
      items,
    };
  });
  res.json(data);
});

api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);

// Express 5 forwards rejected async handlers here.
app.use('/api', (err, _req, res, _next) => {
  console.error('[api]', err?.message ?? err);
  res.status(502).json({ error: 'Market data request failed', detail: String(err?.message ?? err) });
});

// ---------- frontend ----------
if (isProd) {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Stock dashboard running at http://localhost:${port}`);
});
