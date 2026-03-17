import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ComboBox,
  TextInput,
  FilterableMultiSelect,
  Dropdown,
  DatePicker,
  DatePickerInput,
  Checkbox,
  Button,
  IconButton,
  Tag,
} from '@carbon/react';
import { Search as SearchIcon, Close, Filter } from '@carbon/icons-react';
import { contactsApi } from '../../api/customers';
import type { Customer } from '../../types/customer';

export interface MailFilters {
  search: string;
  from: string;
  to: string;
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
  subject: '',
  dateAfter: '',
  dateBefore: '',
  customerIds: [],
  isRead: null,
  hasAttachment: false,
  folder: null,
};

type EmailItem = { id: string; text: string; email: string };

interface MailSearchBarProps {
  filters: MailFilters;
  onFiltersChange: (filters: MailFilters) => void;
  customers: Customer[];
}

export function MailSearchBar({ filters, onFiltersChange, customers }: MailSearchBarProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<MailFilters>(filters);
  const [contactItems, setContactItems] = useState<EmailItem[]>([]);
  const [selectedFrom, setSelectedFrom] = useState<EmailItem | null>(null);
  const [selectedTo, setSelectedTo] = useState<EmailItem | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Lazy-fetch contacts as user types
  const searchContacts = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.length < 2) {
      setContactItems([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const { data: res } = await contactsApi.getAll({ search: query, limit: '20' });
        const items: EmailItem[] = [];
        const seen = new Set<string>();
        for (const c of res.data) {
          if (c.email && !seen.has(c.email)) {
            seen.add(c.email);
            items.push({ id: c.email, text: `${c.firstName} ${c.lastName} <${c.email}>`, email: c.email });
          }
        }
        setContactItems(items);
      } catch {
        // ignore
      }
    }, 300);
  }, []);

  // Customer items for FilterableMultiSelect
  const customerItems = customers.map((c) => ({ id: c.id, text: c.name }));

  // Sync draft with external filters
  useEffect(() => {
    setDraft(filters);
  }, [filters]);

  // Close panel on outside click
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

  const handleSearchSubmit = () => {
    onFiltersChange({ ...draft });
    setPanelOpen(false);
  };

  const handleClearAll = () => {
    const cleared = { ...emptyFilters };
    setDraft(cleared);
    setSelectedFrom(null);
    setSelectedTo(null);
    setContactItems([]);
    onFiltersChange(cleared);
    setPanelOpen(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearchSubmit();
    }
  };

  // Count active advanced filters (excludes search and folder)
  const activeFilterCount = [
    draft.from,
    draft.to,
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
  if (filters.from) activeTags.push({ key: 'from', label: `From: ${filters.from}` });
  if (filters.to) activeTags.push({ key: 'to', label: `To: ${filters.to}` });
  if (filters.subject) activeTags.push({ key: 'subject', label: `Subject: ${filters.subject}` });
  if (filters.dateAfter) activeTags.push({ key: 'dateAfter', label: `After: ${filters.dateAfter}` });
  if (filters.dateBefore) activeTags.push({ key: 'dateBefore', label: `Before: ${filters.dateBefore}` });
  if (filters.customerIds.length > 0) {
    const names = filters.customerIds.map((id) => customers.find((c) => c.id === id)?.name || '...').join(', ');
    activeTags.push({ key: 'customerIds', label: `Company: ${names}` });
  }
  if (filters.isRead !== null) activeTags.push({ key: 'isRead', label: filters.isRead === 'true' ? 'Read' : 'Unread' });
  if (filters.hasAttachment) activeTags.push({ key: 'hasAttachment', label: 'Has attachment' });

  const removeFilter = (key: string) => {
    const updated = { ...filters };
    if (key === 'from' || key === 'to' || key === 'subject' || key === 'dateAfter' || key === 'dateBefore') {
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

  return (
    <div className="mail-search">
      <div className="mail-search__bar" ref={barRef}>
        <div className="mail-search__input-wrap">
          <SearchIcon size={16} className="mail-search__icon" />
          <input
            className="mail-search__input"
            type="text"
            placeholder="Search mail..."
            value={draft.search}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            onKeyDown={handleSearchKeyDown}
          />
          {draft.search && (
            <button
              className="mail-search__clear"
              onClick={() => {
                const updated = { ...draft, search: '' };
                setDraft(updated);
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
              placeholder="Type to search contacts..."
              items={contactItems}
              itemToString={(item: EmailItem | null) => item?.text || ''}
              selectedItem={selectedFrom}
              onChange={({ selectedItem }: { selectedItem: EmailItem | null | undefined }) => {
                const item = selectedItem || null;
                setSelectedFrom(item);
                setDraft({ ...draft, from: item?.email || '' });
              }}
              onInputChange={(value: string) => {
                if (!value) {
                  setSelectedFrom(null);
                  setDraft((d) => ({ ...d, from: '' }));
                }
                searchContacts(value);
              }}
              shouldFilterItem={() => true}
              size="sm"
            />
            <ComboBox
              id="filter-to"
              titleText="To"
              placeholder="Type to search contacts..."
              items={contactItems}
              itemToString={(item: EmailItem | null) => item?.text || ''}
              selectedItem={selectedTo}
              onChange={({ selectedItem }: { selectedItem: EmailItem | null | undefined }) => {
                const item = selectedItem || null;
                setSelectedTo(item);
                setDraft({ ...draft, to: item?.email || '' });
              }}
              onInputChange={(value: string) => {
                if (!value) {
                  setSelectedTo(null);
                  setDraft((d) => ({ ...d, to: '' }));
                }
                searchContacts(value);
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
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
            <FilterableMultiSelect
              id="filter-company"
              titleText="Company"
              placeholder="Filter by company"
              items={customerItems}
              itemToString={(item: { id: string; text: string }) => item?.text || ''}
              initialSelectedItems={customerItems.filter((i) => draft.customerIds.includes(i.id))}
              onChange={({ selectedItems }: { selectedItems: { id: string; text: string }[] }) => {
                setDraft({ ...draft, customerIds: selectedItems.map((i) => i.id) });
              }}
              size="sm"
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
