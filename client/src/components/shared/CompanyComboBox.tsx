import { useState, useEffect, useRef, useCallback } from 'react';
import { ComboBox } from '@carbon/react';
import { customersApi } from '../../api/customers';

interface CompanyItem {
  id: string;
  text: string;
}

interface CompanyComboBoxProps {
  id: string;
  /** Label above the input */
  titleText?: string;
  /** Placeholder when empty */
  placeholder?: string;
  /** Currently selected company ID */
  selectedId: string | null;
  /** Called when selection changes */
  onChange: (companyId: string | null) => void;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to include a "None" option */
  allowNone?: boolean;
}

/**
 * Server-side searchable company picker.
 * Uses Carbon ComboBox with debounced API search.
 * Shows top 20 matches — no preloading of 500+ companies.
 */
export function CompanyComboBox({
  id,
  titleText = 'Company',
  placeholder = 'Type to search companies...',
  selectedId,
  onChange,
  size = 'sm',
  allowNone = true,
}: CompanyComboBoxProps) {
  const [items, setItems] = useState<CompanyItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<CompanyItem | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Load initial item if selectedId is set (resolve name)
  useEffect(() => {
    mountedRef.current = true;
    if (selectedId) {
      customersApi.getAll({ search: '', limit: '20' }).then(({ data: res }) => {
        if (!mountedRef.current) return;
        const all = res.data.map((c: any) => ({ id: c.id, text: c.name }));
        setItems(allowNone ? [{ id: '', text: 'None' }, ...all] : all);
        const match = all.find((c: CompanyItem) => c.id === selectedId);
        if (match) setSelectedItem(match);
      }).catch(() => {});

      // Also try to find the specific one
      customersApi.getById(selectedId).then(({ data: res }) => {
        if (!mountedRef.current) return;
        setSelectedItem({ id: res.data.id, text: res.data.name });
      }).catch(() => {});
    } else {
      // Load initial suggestions
      customersApi.getAll({ limit: '20' }).then(({ data: res }) => {
        if (!mountedRef.current) return;
        const all = res.data.map((c: any) => ({ id: c.id, text: c.name }));
        setItems(allowNone ? [{ id: '', text: 'None' }, ...all] : all);
      }).catch(() => {});
    }
    return () => { mountedRef.current = false; };
  }, [selectedId, allowNone]);

  const handleInputChange = useCallback((inputValue: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params: Record<string, string> = { limit: '20' };
      if (inputValue) params.search = inputValue;
      customersApi.getAll(params).then(({ data: res }) => {
        if (!mountedRef.current) return;
        const all = res.data.map((c: any) => ({ id: c.id, text: c.name }));
        setItems(allowNone ? [{ id: '', text: 'None' }, ...all] : all);
      }).catch(() => {});
    }, 250);
  }, [allowNone]);

  return (
    <ComboBox
      id={id}
      titleText={titleText}
      placeholder={placeholder}
      items={items}
      itemToString={(item: CompanyItem | null) => item?.text || ''}
      selectedItem={selectedItem}
      onChange={({ selectedItem: item }: { selectedItem: CompanyItem | null }) => {
        setSelectedItem(item || null);
        onChange(item?.id || null);
      }}
      onInputChange={handleInputChange}
      size={size}
    />
  );
}
