import { useEffect, useId, useRef, useState } from 'react';
import { api, type SearchResult } from '../api';
import { useDebounced } from '../hooks';

interface Props {
  onSelect: (symbol: string, name?: string) => void;
  placeholder?: string;
  /** Keep the chosen symbol in the input (form field) instead of clearing it. */
  keepValue?: boolean;
  ariaLabel?: string;
}

export function SymbolSearch({ onSelect, placeholder = 'Search symbol or company', keepValue, ariaLabel }: Props) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim(), 200);
  const boxRef = useRef<HTMLDivElement>(null);
  const skipNext = useRef(false);
  const listId = useId();

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    if (!query) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    api
      .search(query, ctrl.signal)
      .then((r) => {
        setResults(r);
        setActive(0);
        setOpen(true);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const choose = (symbol: string, name?: string) => {
    skipNext.current = true;
    setText(keepValue ? symbol : '');
    setResults([]);
    setOpen(false);
    onSelect(symbol, name);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = open ? results[active] : undefined;
      if (hit) choose(hit.symbol, hit.name);
      else if (text.trim()) choose(text.trim().toUpperCase());
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="search" ref={boxRef}>
      <input
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        value={text}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          if (keepValue) onSelect(e.target.value.trim().toUpperCase());
        }}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && results.length > 0 && (
        <ul className="search-list" id={listId} role="listbox">
          {results.map((r, i) => (
            <li
              key={r.symbol}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r.symbol, r.name);
              }}
            >
              <span className="search-symbol">{r.symbol}</span>
              <span className="search-name">{r.name}</span>
              <span className="search-meta">{[r.type, r.exchange].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
