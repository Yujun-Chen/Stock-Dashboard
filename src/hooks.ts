import { useCallback, useEffect, useRef, useState } from 'react';

export interface Polled<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
}

/**
 * Fetch on mount and whenever `key` changes, then re-fetch every `intervalMs`
 * while the tab is visible. Previous data stays on screen during refreshes.
 */
export function usePolling<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs = 0,
): Polled<T> {
  const [state, setState] = useState<Polled<T>>({ data: undefined, error: null, loading: true, updatedAt: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState((s) => ({ ...s, loading: true, error: null }));

    const run = async () => {
      try {
        const data = await fetcherRef.current(ctrl.signal);
        if (ctrl.signal.aborted) return;
        setState({ data, error: null, loading: false, updatedAt: Date.now() });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }));
      }
      if (intervalMs > 0 && !ctrl.signal.aborted) timer = setTimeout(tick, intervalMs);
    };
    const tick = () => {
      if (document.hidden) timer = setTimeout(tick, 2000);
      else void run();
    };
    void run();

    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [key, intervalMs]);

  return state;
}

export function useLocalStorage<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // storage unavailable: keep in-memory state only
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}

export function useHashRoute(): string {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
