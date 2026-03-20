import { useState, useRef, useEffect, useCallback } from 'react';
import { InlineLoading } from '@carbon/react';
import { previewCandidate__SearchBar as SearchBar } from '@carbon/ibm-products';
import {
  Email,
  Task,
  Calendar,
  UserAvatar,
  Search as SearchIcon,
  User,
} from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { searchApi, type SearchResults } from '../../api/search';

type Category = 'emails' | 'tasks' | 'events' | 'customers' | 'contacts';

interface Scope {
  id: string;
  text: string;
}

const SCOPES: Scope[] = [
  { id: 'all', text: 'All' },
  { id: 'emails', text: 'Emails' },
  { id: 'tasks', text: 'Tasks' },
  { id: 'events', text: 'Events' },
  { id: 'customers', text: 'Companies' },
  { id: 'contacts', text: 'Contacts' },
];

interface FlatResult {
  category: Category;
  icon: typeof Email;
  label: string;
  sublabel: string;
  navigateTo: string;
}

const CATEGORY_META: Record<Category, { icon: typeof Email; label: string }> = {
  emails: { icon: Email, label: 'Email results' },
  tasks: { icon: Task, label: 'Task results' },
  events: { icon: Calendar, label: 'Event results' },
  customers: { icon: UserAvatar, label: 'Company results' },
  contacts: { icon: User, label: 'Contact results' },
};

function flattenResults(results: SearchResults, scopeIds: string[]): FlatResult[] {
  const flat: FlatResult[] = [];
  const allCategories: Category[] = ['emails', 'tasks', 'events', 'customers', 'contacts'];
  // If 'all' is selected or no scopes selected, show everything
  const cats = scopeIds.length === 0 || scopeIds.includes('all')
    ? allCategories
    : scopeIds.filter((id): id is Category => allCategories.includes(id as Category));

  for (const cat of cats) {
    if (!results[cat]) continue;
    if (cat === 'emails') {
      for (const email of results.emails) {
        flat.push({
          category: 'emails', icon: Email,
          label: email.subject,
          sublabel: `${email.fromName || email.from} · ${formatDistanceToNow(new Date(email.receivedAt), { addSuffix: true })}`,
          navigateTo: '/mail',
        });
      }
    } else if (cat === 'tasks') {
      for (const task of results.tasks) {
        flat.push({
          category: 'tasks', icon: Task,
          label: task.title,
          sublabel: `${task.status.replace('_', ' ')} · ${task.priority}`,
          navigateTo: '/tasks',
        });
      }
    } else if (cat === 'events') {
      for (const event of results.events) {
        flat.push({
          category: 'events', icon: Calendar,
          label: event.title,
          sublabel: format(new Date(event.startTime), 'MMM d, yyyy · h:mm a'),
          navigateTo: '/calendar',
        });
      }
    } else if (cat === 'customers') {
      for (const customer of results.customers) {
        flat.push({
          category: 'customers', icon: UserAvatar,
          label: customer.name,
          sublabel: customer.company || customer.email || '',
          navigateTo: `/customers/${customer.id}`,
        });
      }
    } else if (cat === 'contacts') {
      for (const contact of results.contacts) {
        flat.push({
          category: 'contacts', icon: User,
          label: `${contact.firstName} ${contact.lastName}`.trim(),
          sublabel: [contact.email, contact.customer?.name].filter(Boolean).join(' · '),
          navigateTo: `/contacts/${contact.id}`,
        });
      }
    }
  }
  return flat;
}

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
  const [selectedScopes, setSelectedScopes] = useState<Scope[]>([SCOPES[0]]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const getScopeIds = (scopes: Scope[]) => scopes.map((s) => s.id);

  const doSearch = useCallback((q: string, scopeIds: string[]) => {
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
        setFlatResults(flattenResults(res.data, scopeIds));
        setOpen(true);
        setFocusIndex(-1);
      } catch {
        if (id === requestIdRef.current) { setResults(null); setFlatResults([]); }
      } finally {
        if (id === requestIdRef.current) setLoading(false);
      }
    }, 300);
  }, []);

  // Re-filter when scopes change
  useEffect(() => {
    if (results && query.trim().length >= 2) {
      setFlatResults(flattenResults(results, getScopeIds(selectedScopes)));
      setFocusIndex(-1);
    }
  }, [selectedScopes, results, query]);

  const handleChange = (e: { value: string; selectedScopes?: Scope[] }) => {
    // SearchBar onChange passes { value } for input changes, and { value, selectedScopes } for scope changes
    const val = e.value ?? '';
    setQuery(val);

    if (e.selectedScopes) {
      setSelectedScopes(e.selectedScopes);
      doSearch(val, getScopeIds(e.selectedScopes));
    } else {
      doSearch(val, getScopeIds(selectedScopes));
    }
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
    const searchParam = encodeURIComponent(query.trim());
    const paths: Record<Category, string> = {
      emails: `/mail?search=${searchParam}`,
      tasks: `/tasks?search=${searchParam}`,
      events: `/calendar?search=${searchParam}`,
      customers: `/customers?search=${searchParam}`,
      contacts: `/contacts?search=${searchParam}`,
    };
    navigate(paths[cat]);
    handleClear();
  }, [query, navigate]);

  const handleSubmit = () => {
    if (query.trim().length >= 2) {
      const scopeIds = getScopeIds(selectedScopes);
      // If exactly one non-all scope is selected, navigate to that page
      const nonAll = scopeIds.filter((id) => id !== 'all');
      if (nonAll.length === 1) {
        handleViewAll(nonAll[0] as Category);
      }
    }
  };

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

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  const scopeIds = getScopeIds(selectedScopes);
  const allCategories: Category[] = ['emails', 'tasks', 'events', 'customers', 'contacts'];
  const categories = results
    ? (scopeIds.includes('all') || scopeIds.length === 0
        ? allCategories
        : scopeIds.filter((id): id is Category => allCategories.includes(id as Category))
      ).filter((cat) => results[cat]?.length > 0)
    : [];

  const hasResults = flatResults.length > 0;
  let flatOffset = 0;

  return (
    <div className="global-search" ref={wrapperRef} onKeyDown={handleKeyDown}>
      <div className="global-search__input">
        <SearchBar
          clearButtonLabelText="Clear"
          labelText="Search"
          placeholderText="Search emails, tasks, events..."
          submitLabel="Search"
          onChange={handleChange}
          onSubmit={handleSubmit}
          scopes={SCOPES}
          selectedScopes={selectedScopes}
          scopesTypeLabel="Scope"
          scopeToString={(scope: Scope) => scope.text}
          onFocus={() => { if (flatResults.length > 0) setOpen(true); }}
        />
      </div>

      {open && (
        <div className="global-search__panel" role="listbox">
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
                  <button className="global-search__view-all" onClick={() => handleViewAll(cat)}>
                    View all
                  </button>
                </div>
                {items.map((_: unknown, i: number) => {
                  const globalIdx = startIdx + i;
                  const flat = flatResults[globalIdx];
                  if (!flat) return null;
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
