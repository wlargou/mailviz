import { useState, useRef, useCallback, useEffect } from 'react';
import { DismissibleTag } from '@carbon/react';
import { contactsApi } from '../../api/contacts';
import type { Contact } from '../../types/customer';

interface RecipientInputProps {
  value: string[];
  onChange: (emails: string[]) => void;
  label: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RecipientInput({ value, onChange, label }: RecipientInputProps) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const addEmail = useCallback((email: string) => {
    const normalized = email.toLowerCase().trim();
    if (normalized && EMAIL_REGEX.test(normalized) && !value.includes(normalized)) {
      onChange([...value, normalized]);
    }
    setInput('');
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightIndex(-1);
  }, [value, onChange]);

  const removeEmail = useCallback((email: string) => {
    onChange(value.filter((e) => e !== email));
  }, [value, onChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Check for comma or semicolon — treat as delimiter
    if (val.includes(',') || val.includes(';')) {
      const parts = val.split(/[,;]/);
      const toAdd = parts[0].trim();
      if (toAdd && EMAIL_REGEX.test(toAdd)) {
        addEmail(toAdd);
      }
      return;
    }
    setInput(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length >= 2) {
      debounceRef.current = setTimeout(async () => {
        try {
          const { data: res } = await contactsApi.search(val, 10);
          setSuggestions(res.data);
          setShowSuggestions(res.data.length > 0);
          setHighlightIndex(-1);
        } catch {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      }, 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (showSuggestions && highlightIndex >= 0 && suggestions[highlightIndex]?.email) {
        e.preventDefault();
        addEmail(suggestions[highlightIndex].email!);
        return;
      }
      if (input.trim() && EMAIL_REGEX.test(input.trim())) {
        e.preventDefault();
        addEmail(input.trim());
      }
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeEmail(value[value.length - 1]);
    } else if (e.key === 'ArrowDown' && showSuggestions) {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && showSuggestions) {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="recipient-field" ref={containerRef}>
      <label className="recipient-field__label">{label}</label>
      <div className="recipient-input" onClick={() => inputRef.current?.focus()}>
        {value.map((email) => (
          <DismissibleTag
            key={email}
            type="high-contrast"
            size="sm"
            text={email}
            onClose={() => removeEmail(email)}
          />
        ))}
        <input
          ref={inputRef}
          className="recipient-input__field"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Add on blur if valid
            if (input.trim() && EMAIL_REGEX.test(input.trim())) {
              addEmail(input.trim());
            }
          }}
          placeholder={value.length === 0 ? 'Add recipients...' : ''}
        />
      </div>
      {showSuggestions && (
        <div className="recipient-input__suggestions">
          {suggestions.map((contact, i) => (
            <div
              key={contact.id}
              className={`recipient-input__suggestion${i === highlightIndex ? ' recipient-input__suggestion--active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                if (contact.email) addEmail(contact.email);
              }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              <span className="recipient-input__suggestion-name">
                {contact.firstName} {contact.lastName}
              </span>
              <span className="recipient-input__suggestion-email">{contact.email}</span>
              {contact.customer && (
                <span className="recipient-input__suggestion-company">{contact.customer.name}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
