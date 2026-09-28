import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { InlineLoading, Search } from '@carbon/react';
import { searchApi, type SearchResults } from '../../api/search';
import { paletteItems, type PaletteItem } from '../../utils/commandPalette';

/**
 * ⌘K / Ctrl+K anywhere: search that acts.
 *
 * One field, one list: the best match first, then what you can do (create,
 * or work for the company or tender you typed), then pages and the other
 * records, and mail last. Arrows move, Enter goes, Escape closes. With
 * nothing typed it lists the create actions and every page, so it doubles as
 * keyboard navigation.
 *
 * Built from a Carbon Search inside a plain dialog rather than a Modal:
 * Carbon has no command palette, and a Modal's header and footer are chrome
 * a palette does not want.
 */

/** Opened by the shortcut, or by anything that dispatches this event. */
export const OPEN_PALETTE_EVENT = 'mailviz:open-palette';

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults(null);
    setActive(0);
    restoreFocus.current?.focus?.();
  }, []);

  const closeRef = useRef(close);
  closeRef.current = open ? close : () => {};

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes wherever focus is — it may not have reached the field yet.
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((was) => {
          if (!was) restoreFocus.current = document.activeElement as HTMLElement | null;
          return !was;
        });
      }
    };
    const onOpen = () => {
      restoreFocus.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    // Capture: Carbon's Search handles Escape itself and stops it there.
    window.addEventListener('keydown', onKey, true);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Debounced search; a stale answer never overwrites a newer one.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const { data } = await searchApi.search(q);
        if (id === requestId.current) setResults(data.data);
      } catch {
        if (id === requestId.current) setResults(null);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const items = useMemo(() => paletteItems(query, results), [query, results]);
  useEffect(() => setActive(0), [items]);

  const go = (item: PaletteItem | undefined) => {
    if (!item) return;
    close();
    navigate(item.href);
  };

  if (!open) return null;

  let lastGroup = '';
  // Not portalled: it renders inside the app shell's <Theme>, so it takes the
  // light or dark tokens the rest of the page has.
  return (
    <div className="palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="palette"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); close(); }
          // One field: Tab stays in it rather than wandering out of the dialog.
          else if (e.key === 'Tab') { e.preventDefault(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
        }}
      >
        <div className="palette__input">
          <Search
            size="lg"
            labelText="Search or run a command"
            placeholder="Search or run a command…"
            value={query}
            onChange={(e: { target: HTMLInputElement }) => setQuery(e.target.value)}
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${active}` : undefined}
            closeButtonLabelText="Clear"
          />
          {loading && <InlineLoading className="palette__loading" description="" />}
        </div>
        <ul id="palette-list" role="listbox" aria-label="Results" className="palette__list">
          {items.length === 0 && !loading && <li className="palette__empty">Nothing matches “{query.trim()}”.</li>}
          {items.map((item, i) => {
            const heading = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {heading && <div className="palette__group" role="presentation">{heading}</div>}
                <div
                  id={`palette-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`palette__item${i === active ? ' palette__item--active' : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                >
                  <span className="palette__label">{item.label}</span>
                  {item.hint && <span className="palette__hint">{item.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="palette__footer" aria-hidden="true">
          <kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> open <kbd>esc</kbd> close
        </div>
      </div>
    </div>
  );
}
