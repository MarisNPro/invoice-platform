'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, type ContactResult, type CompanySearchResult } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { cn, getFlag } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Unified result shown in the dropdown */
export interface AutocompleteOption {
  kind:           'contact' | 'registry';
  // contact-only
  id?:            string;         // Contact UUID → becomes customerId
  // shared display
  name:           string;
  vatNumber?:     string;
  regNumber?:     string;
  country:        string;
  email?:         string;
  address?:       string;
  status:         string;
  // contact address fields (filled from addresses[0])
  street?:        string;
  city?:          string;
  postalCode?:    string;
}

export interface CompanyAutocompleteProps {
  /** Called when the user selects an option */
  onSelect: (option: AutocompleteOption | null) => void;
  /** Currently displayed name (controlled) */
  value?: string;
  /** Error message */
  error?: string;
}

// ── Country selector ──────────────────────────────────────────────────────────

const COUNTRIES = [
  { code: '',   label: 'All countries' },
  { code: 'FI', label: '🇫🇮 Finland' },
  { code: 'EE', label: '🇪🇪 Estonia' },
  { code: 'LV', label: '🇱🇻 Latvia' },
  { code: 'LT', label: '🇱🇹 Lithuania' },
  { code: 'DE', label: '🇩🇪 Germany' },
  { code: 'SE', label: '🇸🇪 Sweden' },
];

// ── Status badge helper ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === 'ACTIVE')   return <Badge variant="success">Active</Badge>;
  if (s === 'INACTIVE') return <Badge variant="destructive">Inactive</Badge>;
  return <Badge variant="outline">Unknown</Badge>;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CompanyAutocomplete({
  onSelect,
  value = '',
  error,
}: CompanyAutocompleteProps) {
  const [query,        setQuery]       = useState(value);
  const [country,      setCountry]     = useState('');
  const [open,         setOpen]        = useState(false);
  const [activeIdx,    setActiveIdx]   = useState(-1);
  const [debouncedQ,   setDebouncedQ]  = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);

  // ── Debounce 300 ms ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const enabled = debouncedQ.trim().length >= 1;

  // ── Contacts search (returns UUIDs → can fill customerId) ─────────────────
  const { data: contacts = [], isFetching: loadingContacts } = useQuery<ContactResult[]>({
    queryKey: ['contacts-search', debouncedQ],
    queryFn: () =>
      apiGet<ContactResult[]>(
        `/contacts?search=${encodeURIComponent(debouncedQ)}&isCustomer=true&limit=8`,
      ),
    enabled,
  });

  // ── Company registry search (fills display fields) ────────────────────────
  const countryParam = country ? `&country=${country}` : '';
  const { data: registry = [], isFetching: loadingRegistry } = useQuery<CompanySearchResult[]>({
    queryKey: ['company-search', debouncedQ, country],
    queryFn: () =>
      apiGet<CompanySearchResult[]>(
        `/companies/search?q=${encodeURIComponent(debouncedQ)}${countryParam}&limit=6`,
      ),
    enabled,
  });

  // ── Merge and deduplicate ─────────────────────────────────────────────────
  const options: AutocompleteOption[] = [
    ...contacts.map((c): AutocompleteOption => ({
      kind:       'contact',
      id:         c.id,
      name:       c.name,
      vatNumber:  c.vatNumber,
      regNumber:  c.businessId,
      country:    c.country,
      email:      c.email,
      status:     'ACTIVE',
      street:     c.addresses[0]?.street,
      city:       c.addresses[0]?.city,
      postalCode: c.addresses[0]?.postalCode,
    })),
    // Registry results whose regNumber isn't already in contacts
    ...registry
      .filter((r) => !contacts.some((c) => c.businessId === r.regNumber || c.vatNumber === r.vatNumber))
      .map((r): AutocompleteOption => ({
        kind:      'registry',
        name:      r.name,
        vatNumber: r.vatNumber,
        regNumber: r.regNumber,
        country:   r.country,
        address:   r.address,
        status:    r.status,
      })),
  ];

  const loading = loadingContacts || loadingRegistry;

  // ── Keyboard nav ──────────────────────────────────────────────────────────
  const handleKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, options.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIdx >= 0 && options[activeIdx]) select(options[activeIdx]);
      } else if (e.key === 'Escape') {
        setOpen(false);
        setActiveIdx(-1);
      }
    },
    [open, options, activeIdx],
  );

  function select(opt: AutocompleteOption) {
    setQuery(opt.name);
    setOpen(false);
    setActiveIdx(-1);
    onSelect(opt);
  }

  function clear() {
    setQuery('');
    setOpen(false);
    onSelect(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!(e.target as Element).closest('[data-autocomplete]')) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2" data-autocomplete>
      {/* Search row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(-1); }}
            onFocus={() => { if (query) setOpen(true); }}
            onKeyDown={handleKey}
            placeholder="Search by name, VAT or registration number…"
            autoComplete="off"
            className={cn(
              'flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm',
              'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors',
              error ? 'border-destructive' : 'border-input',
            )}
          />
          {/* Clear button */}
          {query && (
            <button
              type="button"
              onClick={clear}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              ✕
            </button>
          )}
          {/* Loading indicator */}
          {loading && (
            <span className="absolute right-7 top-1/2 -translate-y-1/2">
              <svg className="h-3.5 w-3.5 animate-spin text-muted-foreground" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            </span>
          )}
        </div>

        {/* Country filter */}
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Dropdown */}
      {open && options.length > 0 && (
        <div className="relative z-50">
          <ul
            ref={listRef}
            role="listbox"
            className="absolute left-0 right-0 top-0 max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
          >
            {/* Group: Existing customers */}
            {contacts.length > 0 && (
              <li className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted/60">
                Your customers
              </li>
            )}
            {contacts.map((_, i) => {
              const opt = options[i]!;
              return (
                <OptionRow
                  key={`c-${opt.id}`}
                  opt={opt}
                  active={activeIdx === i}
                  onMouseEnter={() => setActiveIdx(i)}
                  onSelect={() => select(opt)}
                />
              );
            })}

            {/* Group: Registry results */}
            {registry.filter((r) => !contacts.some((c) => c.businessId === r.regNumber || c.vatNumber === r.vatNumber)).length > 0 && (
              <li className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted/60 border-t border-border">
                Company registry
              </li>
            )}
            {options
              .slice(contacts.length)
              .map((opt, j) => {
                const idx = contacts.length + j;
                return (
                  <OptionRow
                    key={`r-${opt.regNumber}-${opt.country}`}
                    opt={opt}
                    active={activeIdx === idx}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onSelect={() => select(opt)}
                  />
                );
              })}
          </ul>
        </div>
      )}

      {/* No results */}
      {open && enabled && !loading && options.length === 0 && (
        <div className="relative z-50">
          <div className="absolute left-0 right-0 top-0 rounded-md border border-border bg-popover px-4 py-3 text-sm text-muted-foreground shadow-lg">
            No companies found for "{debouncedQ}"
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ── Option row ────────────────────────────────────────────────────────────────

function OptionRow({
  opt,
  active,
  onMouseEnter,
  onSelect,
}: {
  opt: AutocompleteOption;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <li
      role="option"
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => { e.preventDefault(); onSelect(); }}
      className={cn(
        'flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors',
        active ? 'bg-primary/8 text-foreground' : 'hover:bg-muted/60',
      )}
    >
      {/* Flag */}
      <span className="text-lg leading-none mt-0.5 shrink-0">{getFlag(opt.country)}</span>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-sm truncate">{opt.name}</span>
          {opt.kind === 'contact' && (
            <Badge variant="success" className="shrink-0">✓ Customer</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
          {opt.regNumber && <span>Reg: {opt.regNumber}</span>}
          {opt.vatNumber && <span>VAT: {opt.vatNumber}</span>}
          <StatusBadge status={opt.status} />
        </div>
        {opt.kind === 'registry' && (
          <p className="text-xs text-amber-600 mt-0.5">
            Not yet a customer — fills display fields only
          </p>
        )}
      </div>
    </li>
  );
}
