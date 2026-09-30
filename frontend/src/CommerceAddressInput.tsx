import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { City } from './AdminCitiesScreen';
import AddressSuggestDropdown from './components/AddressSuggestDropdown';
import { fetch2gisAddressSuggestions, get2gisSuggestionAddress } from './addressSearch';
import { inputClass } from './commerceApi';

export default function CommerceAddressInput({ label, value, city, onChange, allCities = false }: { label: string; value: string; city?: City; onChange: (value: string) => void; allCities?: boolean }) {
  const anchor = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    if (!focused || !city || value.trim().length < 3) { setSuggestions([]); return; }
    const timer = window.setTimeout(() => { void fetch2gisAddressSuggestions(value, city, { searchAllCities: allCities }).then(rows => { if (alive) setSuggestions(rows); }); }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [city, value, focused, allCities]);
  return <label className="block text-sm font-semibold">{label}
    <input ref={anchor} required minLength={3} maxLength={500} className={`${inputClass} mt-2`} value={value} onChange={e => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} autoComplete="off" />
    <AddressSuggestDropdown anchorRef={anchor} isOpen={focused && suggestions.length > 0}>
      {suggestions.map((row, i) => <li key={row.id || i} role="option" aria-selected={false}><button type="button" className="flex w-full items-start gap-2 px-4 py-3 text-left text-sm font-normal hover:bg-sky-50" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(get2gisSuggestionAddress(row)); setSuggestions([]); setFocused(false); }}><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />{get2gisSuggestionAddress(row)}</button></li>)}
    </AddressSuggestDropdown>
  </label>;
}
