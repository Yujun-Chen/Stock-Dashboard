import { SymbolSearch } from './components/SymbolSearch';
import { stockHref } from './components/PageHead';
import { useHashRoute, useLocalStorage } from './hooks';
import { Earnings } from './pages/Earnings';
import { Overview } from './pages/Overview';
import { Portfolio } from './pages/Portfolio';
import { StockDetail } from './pages/StockDetail';
import { Watchlist } from './pages/Watchlist';

const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA'];

const NAV = [
  { href: '#/', label: 'Overview', match: (r: string) => r === '/' },
  { href: '#/watchlist', label: 'Watchlist', match: (r: string) => r.startsWith('/watchlist') },
  { href: '#/portfolio', label: 'Portfolio', match: (r: string) => r.startsWith('/portfolio') },
  { href: '#/earnings', label: 'Earnings', match: (r: string) => r.startsWith('/earnings') },
];

export function App() {
  const route = useHashRoute();
  const [watchlist, setWatchlist] = useLocalStorage<string[]>('watchlist.symbols', DEFAULT_WATCHLIST);

  const addWatch = (symbol: string) => setWatchlist((prev) => (prev.includes(symbol) ? prev : [...prev, symbol]));
  const removeWatch = (symbol: string) => setWatchlist((prev) => prev.filter((s) => s !== symbol));
  const toggleWatch = (symbol: string) => (watchlist.includes(symbol) ? removeWatch(symbol) : addWatch(symbol));

  let page;
  if (route.startsWith('/stock/')) {
    const symbol = decodeURIComponent(route.slice('/stock/'.length)).toUpperCase();
    page = <StockDetail key={symbol} symbol={symbol} watched={watchlist.includes(symbol)} onToggleWatch={toggleWatch} />;
  } else if (route.startsWith('/watchlist')) {
    page = <Watchlist symbols={watchlist} onAdd={addWatch} onRemove={removeWatch} />;
  } else if (route.startsWith('/portfolio')) {
    page = <Portfolio />;
  } else if (route.startsWith('/earnings')) {
    page = <Earnings watchlist={watchlist} />;
  } else {
    page = <Overview />;
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/">
            Market Dashboard
          </a>
          <nav aria-label="Main">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={n.match(route) ? 'active' : ''} aria-current={n.match(route) ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
          <SymbolSearch onSelect={(symbol) => (window.location.hash = stockHref(symbol))} placeholder="Search stocks, ETFs, indices" />
        </div>
      </header>
      <main>{page}</main>
      <footer className="footer">Quotes from Yahoo Finance, typically delayed 15 minutes. For information only, not investment advice.</footer>
    </>
  );
}
