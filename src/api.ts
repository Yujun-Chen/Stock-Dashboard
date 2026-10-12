export interface Quote {
  symbol: string;
  name: string;
  longName: string;
  type: string;
  exchange: string;
  currency: string;
  marketState: string;
  time: number | null;
  price: number | null;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  pe: number | null;
  forwardPe: number | null;
  eps: number | null;
  dividendYield: number | null;
  week52High: number | null;
  week52Low: number | null;
  extPrice: number | null;
  extChangePct: number | null;
  earningsDate: number | null;
  earningsEstimate: boolean;
}

export interface SectorInfo {
  sector: string | null;
  industry: string | null;
}

export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  time: number | null;
  /** The headline names the company or ticker; otherwise it is only loosely related. */
  direct: boolean;
  /** Calendar day the story was published, as YYYY-MM-DD in the exchange's time zone. */
  day: string;
  /** The stock's daily close on the day the story was published. */
  price: {
    /** Trading day the price is from, as YYYY-MM-DD in the exchange's time zone. */
    day: string;
    close: number;
    changePct: number | null;
    /** False when the story came out on a non-trading day and the previous session is shown. */
    sameDay: boolean;
    currency: string;
  } | null;
}

export type IndexId = 'sp500' | 'ndx' | 'dow';

export interface EarningsItem {
  symbol: string;
  name: string;
  indices: IndexId[];
  date: number;
  dateEnd: number | null;
  /** True when the company has not confirmed the date yet. */
  estimate: boolean;
  marketCap: number | null;
}

export interface EarningsData {
  asOf: number;
  counts: Record<IndexId, number>;
  items: EarningsItem[];
}

export interface ChartPoint {
  t: number;
  c: number;
  v: number;
}

export interface ChartData {
  symbol: string;
  range: string;
  intraday: boolean;
  currency: string;
  timezone: string;
  baseline: number | null;
  points: ChartPoint[];
}

export interface Spark {
  baseline: number | null;
  closes: number[];
}

export interface SearchResult {
  symbol: string;
  name: string;
  type: string;
  exchange: string;
}

export interface Movers {
  gainers: Quote[];
  losers: Quote[];
  actives: Quote[];
}

export interface Profile {
  sector?: string | null;
  industry?: string | null;
  website?: string | null;
  employees?: number | null;
  country?: string | null;
  description?: string | null;
  beta?: number | null;
}

export const RANGES = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'MAX'] as const;
export type Range = (typeof RANGES)[number];

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

const list = (symbols: string[]) => encodeURIComponent(symbols.join(','));

export const api = {
  quotes: (symbols: string[], signal?: AbortSignal) =>
    symbols.length ? get<Quote[]>(`/api/quotes?symbols=${list(symbols)}`, signal) : Promise.resolve([]),
  sparks: (symbols: string[], signal?: AbortSignal) =>
    symbols.length
      ? get<Record<string, Spark | null>>(`/api/sparks?symbols=${list(symbols)}`, signal)
      : Promise.resolve({} as Record<string, Spark | null>),
  chart: (symbol: string, range: Range, signal?: AbortSignal) =>
    get<ChartData>(`/api/chart/${encodeURIComponent(symbol)}?range=${range}`, signal),
  search: (q: string, signal?: AbortSignal) => get<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`, signal),
  movers: (signal?: AbortSignal) => get<Movers>('/api/movers', signal),
  sectors: (symbols: string[], signal?: AbortSignal) =>
    symbols.length
      ? get<Record<string, SectorInfo>>(`/api/sectors?symbols=${list(symbols)}`, signal)
      : Promise.resolve({} as Record<string, SectorInfo>),
  news: (symbol: string, signal?: AbortSignal) => get<NewsItem[]>(`/api/news/${encodeURIComponent(symbol)}`, signal),
  earnings: (signal?: AbortSignal) => get<EarningsData>('/api/earnings', signal),
  profile: (symbol: string, signal?: AbortSignal) =>
    get<Profile>(`/api/profile/${encodeURIComponent(symbol)}`, signal),
};
