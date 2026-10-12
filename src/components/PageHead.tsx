import type { ReactNode } from 'react';
import { fmtClock, marketStateLabel } from '../format';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  marketState?: string;
  updatedAt?: number | null;
  error?: string | null;
  children?: ReactNode;
}

export function PageHead({ title, subtitle, marketState, updatedAt, error, children }: Props) {
  const state = marketStateLabel(marketState);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <div className="page-sub">{subtitle}</div>}
        </div>
        <div className="page-head-side">
          {children}
          <div className="status">
            {state && (
              <span className={`pill ${marketState === 'REGULAR' ? 'open' : ''}`}>
                <span className="pill-dot" aria-hidden="true" />
                {state}
              </span>
            )}
            {updatedAt && <span>Updated {fmtClock(updatedAt)}</span>}
          </div>
        </div>
      </div>
      {error && (
        <div className="banner" role="alert">
          Couldn't refresh market data: {error}. Retrying automatically.
        </div>
      )}
    </>
  );
}

export const stockHref = (symbol: string) => `#/stock/${encodeURIComponent(symbol)}`;
