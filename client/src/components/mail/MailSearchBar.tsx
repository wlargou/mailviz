import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ComboBox,
  TextInput,
  Dropdown,
  DatePicker,
  DatePickerInput,
  Checkbox,
  Button,
  IconButton,
  Tag,
} from '@carbon/react';
import { Search as SearchIcon, Close, Filter, User, Email } from '@carbon/icons-react';
import { emailsApi } from '../../api/emails';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import { HighlightMatch } from '../shared/HighlightMatch';
import { decodeEntities } from '../../utils/text';
import { mailListDate } from '../../utils/dates';
import type { MailSuggestions, SuggestedPerson, SuggestedThread } from '../../types/email';

export interface MailFilters {
  search: string;
  from: string;
  to: string;
  /** One person, whichever way the mail went: from, to, cc or bcc this address. */
  participant: string;
  /** What the participant's chip says — the name that was picked. Never sent to the server. */
  participantName: string;
  subject: string;
  dateAfter: string;
  dateBefore: string;
  customerIds: string[];
  isRead: string | null;
  hasAttachment: boolean;
  folder: string | null;
}

const emptyFilters: MailFilters = {
  search: '',
  from: '',
  to: '',
  participant: '',
  participantName: '',
  subject: '',
  dateAfter: '',
  dateBefore: '',
  customerIds: [],
  isRead: null,
  hasAttachment: false,
  folder: null,
};

type PersonItem = { id: string; text: string; email: string };

function personItem(p: SuggestedPerson): PersonItem {
  return { id: p.address, text: p.name ? `${p.name} <${p.address}>` : p.address, email: p.address };
}

/** A picked address shown as itself when the list no longer holds it. */
function selectedPerson(email: string, picked: PersonItem | null): PersonItem | null {
  if (!email) return null;
  return picked?.email === email ? picked : { id: email, text: email, email };
}

/** What the suggestion list offers, in order: the search itself, then people, then threads. */
type Suggestion =
  | { kind: 'search'; id: string }
  | { kind: 'person'; id: string; person: SuggestedPerson }
  | { kind: 'thread'; id: string; thread: SuggestedThread };

const SUGGEST_DELAY_MS = 250;
const LIST_ID = 'mail-suggest';

/**
 * Searching from the Inbox searches all mail. The Inbox and its Primary tab
 * are a triage view: a search there never found a sent or archived thread —
 * including the ones the suggestions had just offered. A folder chosen on
 * purpose (Sent, Archived …) stays the scope.
 */
export function searchScope(f: MailFilters): MailFilters {
  const searching = f.search.trim() || f.participant || f.from || f.to || f.subject;
  return f.folder === 'inbox' && searching ? { ...f, folder: null } : f;
}

/** Two characters or more, as the server wants: one letter matches half the mailbox. */
const suggestable = (q: string) => q.trim().length >= 2;

interface MailSearchBarProps {
  filters: MailFilters;
  onFiltersChange: (filters: MailFilters) => void;
  /** Opens a thread picked from the suggestions in the reader. */
  onOpenThread?: (threadId: string) => void;
}

export function MailSearchBar({ filters, onFiltersChange, onOpenThread }: MailSearchBarProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<MailFilters>(filters);
  const panelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // ── Suggestions under the search box ──
  //
  // People and threads as you type, from the mail itself: the contacts list
  // it used to lean on is filed by company, and knew nobody on a personal
  // address. Picking a person filters to mail with them either way; picking a
  // thread opens it; the first row runs the search as typed.
  const [suggestions, setSuggestions] = useState<MailSuggestions | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suggestRequest = useRef(0);

  const requestSuggestions = useCallback((q: string) => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    const id = ++suggestRequest.current;
    if (!suggestable(q)) {
      setSuggestions(null);
      return;
    }
    suggestTimer.current = setTimeout(async () => {
      try {
        const { data: res } = await emailsApi.suggest(q.trim());
        // An answer to an earlier keystroke must not replace a later one.
        if (id === suggestRequest.current) setSuggestions(res.data);
      } catch {
        if (id === suggestRequest.current) setSuggestions(null);
      }
    }, SUGGEST_DELAY_MS);
  }, []);

  // ── From and To in the filter panel: the same people ──
  const [fromItems, setFromItems] = useState<PersonItem[]>([]);
  const [toItems, setToItems] = useState<PersonItem[]>([]);
  const [pickedFrom, setPickedFrom] = useState<PersonItem | null>(null);
  const [pickedTo, setPickedTo] = useState<PersonItem | null>(null);
  const peopleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const peopleRequest = useRef(0);

  const searchPeople = useCallback((query: string, setItems: (items: PersonItem[]) => void) => {
    if (peopleTimer.current) clearTimeout(peopleTimer.current);
    const id = ++peopleRequest.current;
    if (!suggestable(query)) {
      setItems([]);
      return;
    }
    peopleTimer.current = setTimeout(async () => {
      try {
        const { data: res } = await emailsApi.suggest(query.trim());
        if (id === peopleRequest.current) setItems(res.data.people.map(personItem));
      } catch {
        // The field keeps whatever it held.
      }
    }, SUGGEST_DELAY_MS);
  }, []);

  useEffect(() => () => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (peopleTimer.current) clearTimeout(peopleTimer.current);
  }, []);

  // Sync draft with external filters
  useEffect(() => {
    setDraft(filters);
  }, [filters]);

  const closeSuggestions = useCallback(() => {
    setSuggestOpen(false);
    setActiveIndex(-1);
  }, []);

  // Close the filter panel on an outside click
  useEffect(() => {
    if (!panelOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        barRef.current && !barRef.current.contains(e.target as Node)
      ) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [panelOpen]);

  // …and the suggestions on any click outside the search box, which holds them.
  useEffect(() => {
    if (!suggestOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) closeSuggestions();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [suggestOpen, closeSuggestions]);

  const handleSearchSubmit = () => {
    onFiltersChange(searchScope({ ...draft }));
    setPanelOpen(false);
  };

  const handleClearAll = () => {
    // The folder survives. It is not a search filter — it is where the user
    // is. Resetting it here silently threw you back to the Inbox whenever you
    // cleared a search while reading Archive, Sent or Snoozed, which is the
    // moment you are least likely to be watching the folder list. The count
    // beside this button already excludes the folder for the same reason.
    const cleared = { ...emptyFilters, folder: draft.folder };
    setDraft(cleared);
    setPickedFrom(null);
    setPickedTo(null);
    setFromItems([]);
    setToItems([]);
    onFiltersChange(cleared);
    setPanelOpen(false);
  };

  const query = draft.search.trim();
  const people = suggestable(query) ? suggestions?.people ?? [] : [];
  const threads = suggestable(query) ? suggestions?.threads ?? [] : [];
  const options: Suggestion[] = suggestable(query)
    ? [
        { kind: 'search', id: `${LIST_ID}-search` },
        ...people.map((person, i) => ({ kind: 'person' as const, id: `${LIST_ID}-person-${i}`, person })),
        ...threads.map((thread, i) => ({ kind: 'thread' as const, id: `${LIST_ID}-thread-${i}`, thread })),
      ]
    : [];
  const listOpen = suggestOpen && options.length > 0;

  const choose = (option: Suggestion) => {
    closeSuggestions();
    if (option.kind === 'search') {
      handleSearchSubmit();
    } else if (option.kind === 'person') {
      // The person replaces the words typed to find them: "hicham" was the
      // way to reach GADI-ALAMI HICHAM, not something his mail must contain.
      const next = searchScope({
        ...draft,
        search: '',
        participant: option.person.address,
        participantName: option.person.name ?? '',
      });
      setDraft(next);
      onFiltersChange(next);
      setPanelOpen(false);
    } else {
      // Nothing was searched, so the box goes back to what the list shows.
      setDraft((d) => ({ ...d, search: filters.search }));
      onOpenThread?.(option.thread.threadId);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (options.length === 0) return;
      e.preventDefault();
      const down = e.key === 'ArrowDown';
      setSuggestOpen(true);
      setActiveIndex((i) => (down ? (i + 1) % options.length : i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = listOpen && activeIndex >= 0 ? options[activeIndex] : undefined;
      if (active) {
        choose(active);
      } else {
        closeSuggestions();
        handleSearchSubmit();
      }
    } else if (e.key === 'Escape') {
      // Closes the list, and only the list — not the reader beside it.
      if (listOpen) {
        e.preventDefault();
        e.stopPropagation();
        closeSuggestions();
      }
    } else if (e.key === 'Tab') {
      closeSuggestions();
    }
  };

  // Count active advanced filters (excludes search and folder)
  const activeFilterCount = [
    draft.from,
    draft.to,
    draft.participant,
    draft.subject,
    draft.dateAfter,
    draft.dateBefore,
    draft.customerIds.length > 0,
    draft.isRead,
    draft.hasAttachment,
  ].filter(Boolean).length;

  const readFilterItems = [
    { id: '__all__', text: 'All' },
    { id: 'false', text: 'Unread' },
    { id: 'true', text: 'Read' },
  ];

  // Active filter tags for display
  const activeTags: { key: string; label: string }[] = [];
  if (filters.participant) activeTags.push({ key: 'participant', label: `With: ${filters.participantName || filters.participant}` });
  if (filters.from) activeTags.push({ key: 'from', label: `From: ${filters.from}` });
  if (filters.to) activeTags.push({ key: 'to', label: `To: ${filters.to}` });
  if (filters.subject) activeTags.push({ key: 'subject', label: `Subject: ${filters.subject}` });
  if (filters.dateAfter) activeTags.push({ key: 'dateAfter', label: `After: ${filters.dateAfter}` });
  if (filters.dateBefore) activeTags.push({ key: 'dateBefore', label: `Before: ${filters.dateBefore}` });
  if (filters.customerIds.length > 0) {
    activeTags.push({ key: 'customerIds', label: `Company filter active` });
  }
  if (filters.isRead !== null) activeTags.push({ key: 'isRead', label: filters.isRead === 'true' ? 'Read' : 'Unread' });
  if (filters.hasAttachment) activeTags.push({ key: 'hasAttachment', label: 'Has attachment' });

  const removeFilter = (key: string) => {
    const updated = { ...filters };
    if (key === 'participant') {
      updated.participant = '';
      updated.participantName = '';
    } else if (key === 'from' || key === 'to' || key === 'subject' || key === 'dateAfter' || key === 'dateBefore') {
      updated[key] = '';
    } else if (key === 'customerIds') {
      updated.customerIds = [];
    } else if (key === 'isRead') {
      updated.isRead = null;
    } else if (key === 'hasAttachment') {
      updated.hasAttachment = false;
    }
    onFiltersChange(updated);
  };

  const selectedFrom = selectedPerson(draft.from, pickedFrom);
  const selectedTo = selectedPerson(draft.to, pickedTo);

  /** Props every row of the list shares. */
  const optionProps = (option: Suggestion, index: number) => ({
    id: option.id,
    role: 'option' as const,
    'aria-selected': index === activeIndex,
    className: `mail-suggest__option${index === activeIndex ? ' mail-suggest__option--active' : ''}`,
    // Keeps focus in the box, so the keyboard carries on where the mouse left off.
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => choose(option),
    onMouseEnter: () => setActiveIndex(index),
  });

  return (
    <div className="mail-search">
      <div className="mail-search__bar" ref={barRef}>
        <div className="mail-search__input-wrap">
          <SearchIcon size={16} className="mail-search__icon" />
          <input
            className="mail-search__input"
            type="text"
            placeholder="Search mail, people or subjects"
            aria-label="Search mail"
            role="combobox"
            aria-expanded={listOpen}
            aria-controls={LIST_ID}
            aria-autocomplete="list"
            aria-activedescendant={listOpen && activeIndex >= 0 ? options[activeIndex]?.id : undefined}
            value={draft.search}
            onChange={(e) => {
              const value = e.target.value;
              setDraft({ ...draft, search: value });
              setActiveIndex(-1);
              setSuggestOpen(suggestable(value));
              requestSuggestions(value);
            }}
            onFocus={() => {
              if (!suggestable(draft.search)) return;
              setSuggestOpen(true);
              if (!suggestions) requestSuggestions(draft.search);
            }}
            onKeyDown={handleSearchKeyDown}
          />
          {draft.search && (
            <button
              className="mail-search__clear"
              onClick={() => {
                const updated = { ...draft, search: '' };
                setDraft(updated);
                closeSuggestions();
                requestSuggestions('');
                onFiltersChange(updated);
              }}
              aria-label="Clear search"
            >
              <Close size={16} />
            </button>
          )}
        </div>
        <IconButton
          kind="ghost"
          size="sm"
          label="Advanced filters"
          onClick={() => setPanelOpen(!panelOpen)}
          className={`mail-search__filter-btn${panelOpen ? ' mail-search__filter-btn--active' : ''}`}
        >
          <Filter size={16} />
          {activeFilterCount > 0 && (
            <span className="mail-search__badge">{activeFilterCount}</span>
          )}
        </IconButton>

        {listOpen && (
          <div className="mail-suggest" role="listbox" id={LIST_ID} aria-label="Search suggestions">
            <div {...optionProps(options[0], 0)}>
              <SearchIcon size={16} className="mail-suggest__icon" />
              <span className="mail-suggest__text">
                <span className="mail-suggest__label">
                  Search mail for “<span className="search-highlight">{query}</span>”
                </span>
              </span>
            </div>
            {people.length > 0 && (
              <div className="mail-suggest__group" role="group" aria-labelledby={`${LIST_ID}-people`}>
                <div className="mail-suggest__header" id={`${LIST_ID}-people`}>People</div>
                {people.map((person, i) => {
                  const index = 1 + i;
                  return (
                    <div
                      key={person.address}
                      {...optionProps(options[index], index)}
                      // Named outright: read from the highlighted pieces, name
                      // and address ran together into one word.
                      aria-label={person.name ? `${person.name}, ${person.address}` : person.address}
                    >
                      <User size={16} className="mail-suggest__icon" />
                      <span className="mail-suggest__text">
                        <span className="mail-suggest__label">
                          <HighlightMatch text={person.name ?? person.address} query={query} />
                        </span>
                        {person.name && (
                          <span className="mail-suggest__sub">
                            <HighlightMatch text={person.address} query={query} />
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {threads.length > 0 && (
              <div className="mail-suggest__group" role="group" aria-labelledby={`${LIST_ID}-threads`}>
                <div className="mail-suggest__header" id={`${LIST_ID}-threads`}>Mail</div>
                {threads.map((thread, i) => {
                  const index = 1 + people.length + i;
                  const subject = decodeEntities(thread.subject) || '(no subject)';
                  const sender = decodeEntities(thread.fromName || thread.from);
                  const when = mailListDate(thread.receivedAt);
                  return (
                    <div
                      key={thread.threadId}
                      {...optionProps(options[index], index)}
                      aria-label={`${subject}, from ${sender}, ${when}`}
                    >
                      <Email size={16} className="mail-suggest__icon" />
                      <span className="mail-suggest__text">
                        <span className="mail-suggest__label">
                          <HighlightMatch text={subject} query={query} />
                        </span>
                        <span className="mail-suggest__sub">
                          <HighlightMatch text={sender} query={query} />
                          {' · '}
                          {when}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {activeTags.length > 0 && (
        <div className="mail-search__tags">
          {activeTags.map((tag) => (
            <Tag
              key={tag.key}
              type="high-contrast"
              size="sm"
              filter
              onClose={() => removeFilter(tag.key)}
              title="Remove filter"
            >
              {tag.label}
            </Tag>
          ))}
          <button className="mail-search__clear-all" onClick={handleClearAll}>
            Clear all
          </button>
        </div>
      )}

      {panelOpen && (
        <div className="mail-search__panel" ref={panelRef}>
          <div className="mail-search__panel-grid">
            <ComboBox
              id="filter-from"
              titleText="From"
              placeholder="Type a name or an address"
              items={fromItems}
              itemToString={(item: PersonItem | null) => item?.text || ''}
              selectedItem={selectedFrom}
              onChange={({ selectedItem }: { selectedItem?: PersonItem | null }) => {
                const item = selectedItem || null;
                setPickedFrom(item);
                setDraft((d) => ({ ...d, from: item?.email || '' }));
              }}
              onInputChange={(value: string) => {
                // The box echoing a pick is not a new search.
                if (value === (selectedFrom?.text ?? '')) return;
                if (!value) {
                  setPickedFrom(null);
                  setDraft((d) => ({ ...d, from: '' }));
                }
                searchPeople(value, setFromItems);
              }}
              shouldFilterItem={() => true}
              size="sm"
            />
            <ComboBox
              id="filter-to"
              titleText="To"
              placeholder="Type a name or an address"
              items={toItems}
              itemToString={(item: PersonItem | null) => item?.text || ''}
              selectedItem={selectedTo}
              onChange={({ selectedItem }: { selectedItem?: PersonItem | null }) => {
                const item = selectedItem || null;
                setPickedTo(item);
                setDraft((d) => ({ ...d, to: item?.email || '' }));
              }}
              onInputChange={(value: string) => {
                if (value === (selectedTo?.text ?? '')) return;
                if (!value) {
                  setPickedTo(null);
                  setDraft((d) => ({ ...d, to: '' }));
                }
                searchPeople(value, setToItems);
              }}
              shouldFilterItem={() => true}
              size="sm"
            />
            <TextInput
              id="filter-subject"
              labelText="Subject"
              placeholder="Keywords in subject"
              size="sm"
              value={draft.subject}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, subject: e.target.value })}
            />
            <CompanyComboBox
              id="filter-company"
              titleText="Company"
              selectedId={draft.customerIds[0] || null}
              onChange={(id) => {
                setDraft((prev) => ({ ...prev, customerIds: id ? [id] : [] }));
              }}
              size="sm"
              allowNone
            />
            <div className="mail-search__date-row">
              <DatePicker
                datePickerType="single"
                dateFormat="Y-m-d"
                value={draft.dateAfter || undefined}
                onChange={([date]: Date[]) => {
                  setDraft({ ...draft, dateAfter: date ? date.toISOString().split('T')[0] : '' });
                }}
              >
                <DatePickerInput
                  id="filter-date-after"
                  labelText="Date after"
                  placeholder="yyyy-mm-dd"
                  size="sm"
                />
              </DatePicker>
              <DatePicker
                datePickerType="single"
                dateFormat="Y-m-d"
                value={draft.dateBefore || undefined}
                onChange={([date]: Date[]) => {
                  setDraft({ ...draft, dateBefore: date ? date.toISOString().split('T')[0] : '' });
                }}
              >
                <DatePickerInput
                  id="filter-date-before"
                  labelText="Date before"
                  placeholder="yyyy-mm-dd"
                  size="sm"
                />
              </DatePicker>
            </div>
            <div className="mail-search__check-row">
              <Dropdown
                id="filter-read"
                titleText="Status"
                label="All"
                items={readFilterItems}
                itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
                selectedItem={readFilterItems.find((d) => d.id === (draft.isRead || '__all__')) || readFilterItems[0]}
                onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
                  setDraft({ ...draft, isRead: selectedItem?.id === '__all__' ? null : selectedItem?.id || null });
                }}
                size="sm"
              />
              <Checkbox
                id="filter-attachment"
                labelText="Has attachment"
                checked={draft.hasAttachment}
                onChange={(_: React.ChangeEvent<HTMLInputElement>, { checked }: { checked: boolean }) => {
                  setDraft({ ...draft, hasAttachment: checked });
                }}
              />
            </div>
          </div>
          <div className="mail-search__panel-actions">
            <Button kind="ghost" size="sm" onClick={handleClearAll}>
              Clear all
            </Button>
            <Button kind="primary" size="sm" onClick={handleSearchSubmit}>
              Search
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
