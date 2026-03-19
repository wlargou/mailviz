import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, InlineLoading } from '@carbon/react';
import {
  Email,
  Task,
  Calendar,
  UserAvatar,
  Search as SearchIcon,
  ArrowRight,
  User,
} from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { searchApi, type SearchResults } from '../../api/search';

type Category = 'emails' | 'tasks' | 'events' | 'customers' | 'contacts';

interface FlatResult {
  category: Category;
  icon: typeof Email;
  label: string;
  sublabel: string;
  navigateTo: string;
}

const CATEGORY_META: Record<Category, { icon: typeof Email; label: string; viewAllPath: string }> = {
  emails: { icon: Email, label: 'Email results', viewAllPath: '/mail' },
  tasks: { icon: Task, label: 'Task results', viewAllPath: '/tasks' },
  events: { icon: Calendar, label: 'Event results', viewAllPath: '/calendar' },
  customers: { icon: UserAvatar, label: 'Customer results', viewAllPath: '/customers' },
  contacts: { icon: User, label: 'Contact results', viewAllPath: '/contacts' },
};

function flattenResults(results: SearchResults): FlatResult[] {
  const flat: FlatResult[] = [];

  for (const email of results.emails) {
    flat.push({
      category: 'emails',
      icon: Email,
      label: email.subject,
      sublabel: `${email.fromName || email.from} · ${formatDistanceToNow(new Date(email.receivedAt), { addSuffix: true })}`,
      navigateTo: '/mail',
    });
  }

  for (const task of results.tasks) {
    flat.push({
      category: 'tasks',
      icon: Task,
      label: task.title,
      sublabel: `${task.status.replace('_', ' ')} · ${task.priority}`,
      navigateTo: '/tasks',
    });
  }

  for (const event of results.events) {
    flat.push({
      category: 'events',
      icon: Calendar,
      label: event.title,
      sublabel: format(new Date(event.startTime), 'MMM d, yyyy · h:mm a'),
      navigateTo: '/calendar',
    });
  }

  for (const customer of results.customers) {
    flat.push({
      category: 'customers',
      icon: UserAvatar,
      label: customer.name,
      sublabel: customer.company || customer.email || '',
      navigateTo: `/customers/${customer.id}`,
    });
  }

  for (const contact of results.contacts) {
    const name = `${contact.firstName} ${contact.lastName}`.trim();
    flat.push({
      category: 'contacts',
      icon: User,
      label: name,
      sublabel: [contact.email, contact.customer?.name].filter(Boolean).join(' · '),
      navigateTo: `/contacts/${contact.id}`,
    });
  }

  return flat;
}

/** Highlight matching portions of text by wrapping them in <strong> */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <strong key={i} className="global-search__highlight">{part}</strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [flatResults, setFlatResults] = useState<FlatResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (q.trim().length < 2) {
      setResults(null);
      setFlatResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const id = ++requestIdRef.current;
      try {
        const { data: res } = await searchApi.search(q.trim());
        if (id !== requestIdRef.current) return;
        setResults(res.data);
        const flat = flattenResults(res.data);
        setFlatResults(flat);
        setOpen(true);
        setFocusIndex(-1);
      } catch {
        if (id === requestIdRef.current) {
          setResults(null);
          setFlatResults([]);
        }
      } finally {
        if (id === requestIdRef.current) setLoading(false);
      }
    }, 300);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    doSearch(val);
  };

  const handleClear = () => {
    setQuery('');
    setResults(null);
    setFlatResults([]);
    setOpen(false);
    setFocusIndex(-1);
  };

  const selectResult = useCallback((idx: number) => {
    const item = flatResults[idx];
    if (!item) return;
    navigate(item.navigateTo);
    handleClear();
  }, [flatResults, navigate]);

  const handleViewAll = useCallback((cat: Category) => {
    const meta = CATEGORY_META[cat];
    const q = query.trim();
    // Navigate to the category page with search query
    const searchParam = encodeURIComponent(q);
    switch (cat) {
      case 'emails':
        navigate(`/mail?search=${searchParam}`);
        break;
      case 'tasks':
        navigate(`/tasks?search=${searchParam}`);
        break;
      case 'events':
        navigate(`/calendar?search=${searchParam}`);
        break;
      case 'customers':
        navigate(`/customers?search=${searchParam}`);
        break;
      case 'contacts':
        navigate(`/contacts?search=${searchParam}`);
        break;
      default:
        navigate(meta.viewAllPath);
    }
    handleClear();
  }, [query, navigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || flatResults.length === 0) {
      if (e.key === 'Escape') handleClear();
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIndex((prev) => (prev + 1) % flatResults.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIndex((prev) => (prev <= 0 ? flatResults.length - 1 : prev - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusIndex >= 0) selectResult(focusIndex);
        break;
      case 'Escape':
        e.preventDefault();
        handleClear();
        break;
    }
  };

  // Outside click to close
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const categories = results
    ? (['emails', 'tasks', 'events', 'customers', 'contacts'] as const).filter(
        (cat) => results[cat].length > 0
      )
    : [];

  const hasResults = flatResults.length > 0;
  let flatOffset = 0;

  return (
    <div className="global-search" ref={wrapperRef}>
      <div className="global-search__input" role="combobox" aria-expanded={open} aria-haspopup="listbox">
        <Search
          size="sm"
          placeholder="Search emails, tasks, events..."
          labelText="Global search"
          closeButtonLabelText="Clear"
          id="global-search-input"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (flatResults.length > 0) setOpen(true);
          }}
          autoComplete="off"
        />
      </div>

      {open && (
        <div className="global-search__panel" role="listbox" id="global-search-results">
          {loading && (
            <div className="global-search__loading">
              <InlineLoading description="Searching..." />
            </div>
          )}

          {!loading && !hasResults && query.trim().length >= 2 && (
            <div className="global-search__empty">
              <SearchIcon size={20} />
              <span>No results for &ldquo;{query}&rdquo;</span>
            </div>
          )}

          {!loading && hasResults && categories.map((cat) => {
            const meta = CATEGORY_META[cat];
            const items = results![cat];
            const startIdx = flatOffset;
            flatOffset += items.length;

            return (
              <div key={cat} className="global-search__category">
                <div className="global-search__category-header">
                  <span>{meta.label}</span>
                  <button
                    className="global-search__view-all"
                    onClick={() => handleViewAll(cat)}
                  >
                    View all
                  </button>
                </div>
                {items.map((_, i) => {
                  const globalIdx = startIdx + i;
                  const flat = flatResults[globalIdx];
                  const isFocused = globalIdx === focusIndex;
                  const Icon = flat.icon;

                  return (
                    <div
                      key={globalIdx}
                      role="option"
                      aria-selected={isFocused}
                      className={`global-search__result${isFocused ? ' global-search__result--focused' : ''}`}
                      onClick={() => selectResult(globalIdx)}
                      onMouseEnter={() => setFocusIndex(globalIdx)}
                    >
                      <Icon size={16} className="global-search__result-icon" />
                      <div className="global-search__result-text">
                        <div className="global-search__result-label">
                          <HighlightMatch text={flat.label} query={query.trim()} />
                        </div>
                        <div className="global-search__result-sublabel">
                          <HighlightMatch text={flat.sublabel} query={query.trim()} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
