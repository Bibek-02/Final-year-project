import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Lock, ChevronDown } from 'lucide-react';
import client from '../api/client';

const MAX_VISIBLE_OPTIONS = 50;
const GRANULARITY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

// Accessible combobox for admins choosing among up to ~1,115 stores: a
// text filter + listbox rather than a native <select>, which would force
// scrolling through a thousand-plus unsorted <option>s. Rendered options
// are capped (MAX_VISIBLE_OPTIONS) since re-rendering 1,115 DOM nodes on
// every keystroke is wasted work the filter already made unnecessary.
function StoreCombobox({ storeIds, selectedStore, setSelectedStore }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim();
    const matches = q
      ? storeIds.filter(id => String(id).includes(q))
      : storeIds;
    return matches.slice(0, MAX_VISIBLE_OPTIONS);
  }, [query, storeIds]);

  const displayValue = isOpen ? query : `Store ${selectedStore}`;

  const openList = () => {
    setIsOpen(true);
    setQuery('');
    setHighlighted(0);
  };

  const commitSelection = (id) => {
    if (id == null) return;
    setSelectedStore(id);
    setIsOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      openList();
      return;
    }
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitSelection(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setQuery('');
    }
  };

  const activeId = isOpen && filtered[highlighted] != null
    ? `store-option-${filtered[highlighted]}`
    : undefined;

  return (
    <div className="relative">
      <label htmlFor="store-combobox" className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
        Store
      </label>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          id="store-combobox"
          ref={inputRef}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="store-listbox"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          value={displayValue}
          onFocus={openList}
          onClick={openList}
          onChange={e => { setQuery(e.target.value); setIsOpen(true); setHighlighted(0); }}
          onKeyDown={handleKeyDown}
          onBlur={() => setIsOpen(false)}
          placeholder="Search store ID…"
          className="w-44 pl-8 pr-7 py-2 rounded-lg border border-gray-200 dark:border-gray-600
                     text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100
                     focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:focus:ring-indigo-500/50"
        />
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />

        {isOpen && (
          <ul
            id="store-listbox"
            role="listbox"
            aria-label="Store results"
            className="absolute z-20 mt-1 w-56 max-h-64 overflow-y-auto rounded-lg border
                       border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800
                       shadow-lg py-1 text-sm"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-gray-400 dark:text-gray-500">No matching stores</li>
            )}
            {filtered.map((id, i) => (
              <li
                key={id}
                id={`store-option-${id}`}
                role="option"
                aria-selected={id === selectedStore}
                // Selection must win before the input's blur handler closes
                // the list — onMouseDown fires first and preventDefault
                // keeps focus on the input so blur doesn't race it.
                onMouseDown={e => e.preventDefault()}
                onClick={() => commitSelection(id)}
                className={`px-3 py-1.5 cursor-pointer ${
                  i === highlighted ? 'bg-indigo-50 dark:bg-indigo-500/15' : ''
                } ${
                  id === selectedStore
                    ? 'font-semibold text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-700 dark:text-gray-200'
                }`}
              >
                Store {id}
              </li>
            ))}
            {storeIds.length > MAX_VISIBLE_OPTIONS && filtered.length === MAX_VISIBLE_OPTIONS && (
              <li className="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 border-t
                             border-gray-100 dark:border-gray-700 mt-1 pt-1.5">
                Showing {MAX_VISIBLE_OPTIONS} of {storeIds.length.toLocaleString()} — keep typing to narrow
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

// Managers get a non-interactive badge, not a disabled combobox — there is
// structurally no control to pick another store, rather than a visually
// disabled one a user might expect to be able to activate.
function LockedStoreBadge({ assignedStore }) {
  return (
    <div>
      <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Store</label>
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200
                      dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-sm font-semibold
                      text-gray-700 dark:text-gray-200">
        <Lock size={13} className="text-gray-400 flex-shrink-0" />
        Store {assignedStore}
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Assigned store only</p>
    </div>
  );
}

// Weekly/Monthly as a radiogroup (a mutually-exclusive persistent choice,
// not a set of tabbed panels) with roving tabindex + arrow-key navigation,
// per WAI-ARIA radio-group authoring practice.
function GranularityControl({ forecastType, setForecastType }) {
  const refs = useRef({});

  const focusAndSelect = (value) => {
    setForecastType(value);
    refs.current[value]?.focus();
  };

  const handleKeyDown = (e) => {
    const idx = GRANULARITY_OPTIONS.findIndex(o => o.value === forecastType);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusAndSelect(GRANULARITY_OPTIONS[(idx + 1) % GRANULARITY_OPTIONS.length].value);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusAndSelect(GRANULARITY_OPTIONS[(idx - 1 + GRANULARITY_OPTIONS.length) % GRANULARITY_OPTIONS.length].value);
    }
  };

  return (
    <div>
      <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1" id="granularity-label">
        Weekly or monthly view
      </label>
      <div
        role="radiogroup"
        aria-labelledby="granularity-label"
        onKeyDown={handleKeyDown}
        className="inline-flex w-full sm:w-auto rounded-lg border border-gray-200
                   dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-0.5"
      >
        {GRANULARITY_OPTIONS.map(opt => {
          const selected = forecastType === opt.value;
          return (
            <button
              key={opt.value}
              ref={el => { refs.current[opt.value] = el; }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setForecastType(opt.value)}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-sm font-semibold
                         transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400
                         focus:ring-offset-1 dark:focus:ring-offset-gray-900 ${
                selected
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function StoreSelector({
  selectedStore, setSelectedStore,
  forecastType,  setForecastType,
  userRole, assignedStore
}) {
  const [storeIds, setStoreIds] = useState([]);

  useEffect(() => {
    client.get(`/forecast/stores/list?forecast_type=${forecastType}`)
      .then(res => setStoreIds(res.data.store_ids))
      .catch(() => {});
  }, [forecastType]);

  const isManager = userRole === 'manager';

  return (
    <div className="flex gap-6 items-start sm:items-center flex-wrap bg-white dark:bg-gray-800
                    rounded-xl px-4 py-3 mb-4 shadow-sm border border-gray-100 dark:border-gray-700">
      {isManager
        ? <LockedStoreBadge assignedStore={assignedStore} />
        : <StoreCombobox storeIds={storeIds} selectedStore={selectedStore} setSelectedStore={setSelectedStore} />}

      <GranularityControl forecastType={forecastType} setForecastType={setForecastType} />
    </div>
  );
}
