import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ClipboardList, Heart, Loader2, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import CommerceShell from './CommerceShell';
import WholesaleRequestCard, { wholesaleStates as states } from './WholesaleRequestCard';
import NotificationCenter from './components/shared/NotificationCenter';
import ReasonModal from './components/admin/ReasonModal';
import CommerceAddressInput from './CommerceAddressInput';
import { buttonClass, commerceApi, dateTime, inputClass, rubles } from './commerceApi';
import { useAuthStore } from './store';
import { useCityStore } from './cityStore';
import { baseURL, formatPhoneNumber } from './utils';

interface Announcement {
  id: string; author_id: string; city_id: string; material_id: string | null; material_name: string; volume: string; unit: string;
  vehicle_count: number | null; pickup_address: string; delivery_address: string; starts_on: string; ends_on: string; price: string;
  price_basis: string; contact_name: string; contact_phone: string; comment: string | null; status: string; reject_reason: string | null;
  is_owner: boolean; is_favorite: boolean; created_at: string;
}

const units: Record<string, string> = { m3: 'м³', t: 'т', vehicle: 'машину', total: 'весь объём' };
const today = () => new Date().toLocaleDateString('sv-SE');
const blank = (cityId: string) => ({ city_id: cityId, material_id: '', material_name: '', volume: '', unit: 'm3', vehicle_count: '', pickup_address: '', delivery_address: '', starts_on: today(), ends_on: today(), price: '', price_basis: 'm3', contact_name: '', contact_phone: '', comment: '' });

export default function WholesaleScreen({ onClose, initialView = 'all' }: { onClose: () => void; initialView?: 'all' | 'moderation' }) {
  const role = useAuthStore(s => s.role);
  const token = useAuthStore(s => s.token);
  const { cities, cityId, refresh } = useCityStore();
  const [view, setView] = useState(new URLSearchParams(window.location.search).has('notification_wholesale') ? 'mine' : initialView);
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Announcement[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Announcement | null>(null);
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [reasonAction, setReasonAction] = useState<'reject' | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => { void refresh(); }, [refresh]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ view, q, page: String(page) });
      if (city) params.set('city_id', city);
      if (from) params.set('starts_on', from);
      if (to) params.set('ends_on', to);
      const data = await commerceApi(`/wholesale-requests?${params}`, { signal });
      setRows(data.items); setTotal(data.total);
    } catch (e: any) { if (e.name !== 'AbortError') setError(e.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [view, q, city, from, to, page]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const action = async (path: string, body: unknown = {}, method = 'POST') => {
    setBusy(true);
    try {
      const result = await commerceApi(`/wholesale-requests/${path}`, { method, body: JSON.stringify(body) });
      if (result.id) setDetail(result);
      await load(); toast.success('Сохранено'); return true;
    } catch (e: any) { toast.error(e.message); return false; }
    finally { setBusy(false); }
  };
  const open = async (row: Pick<Announcement, 'id'>) => {
    try {
      const data = await commerceApi(`/wholesale-requests/${row.id}`); setDetail(data); setHistory([]);
      if (data.is_owner || role === 'admin') setHistory(await commerceApi(`/wholesale-requests/${row.id}/history`));
    } catch (e: any) { toast.error(e.message); }
  };
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('notification_wholesale');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) void open({ id });
  }, []);
  const embedded = role === 'driver' || role === 'supplier';
  const headerActions = <NotificationCenter token={token} overlayZIndex={100001} />;
  if (editing) return <WholesaleForm embedded={embedded} headerActions={headerActions} request={editing === 'new' ? null : editing} initialCity={cityId || ''} cities={cities.filter(c => c.is_active)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setDetail(null); setView('mine'); setPage(1); void load(); }} />;
  return <CommerceShell embedded={embedded} headerActions={headerActions} title="Оптовые заявки" subtitle="Крупные объёмы · прямые договорённости" onClose={detail ? () => { setDetail(null); setReasonAction(null); } : onClose}>
    {detail ? <>
      <WholesaleRequestCard request={detail} />
      <p className="px-2 text-xs text-slate-400">Стоимость, сроки и количество машин согласовываются напрямую с автором.</p>
      {detail.is_owner && detail.status !== 'archived' && <div className="flex flex-wrap gap-2"><button disabled={busy} className={buttonClass} onClick={() => setEditing(detail)}>Редактировать</button>{detail.status !== 'archived' && <button disabled={busy} className="rounded-xl bg-white px-4 py-3 text-sm font-bold" onClick={() => action(`${detail.id}/close`)}>Закрыть заявку</button>}</div>}
      {role === 'admin' && <div className="rounded-2xl bg-white p-4">
        <h3 className="mb-3 font-bold">Модерация</h3>
        <div className="flex flex-wrap gap-2">
          {detail.status === 'pending' && <>
            <button disabled={busy} className={buttonClass} onClick={() => action(`${detail.id}/moderate`, { action: 'approve' })}>Одобрить</button>
            <button disabled={busy} className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700" onClick={() => { setReasonAction('reject'); setReason(''); }}>Отклонить</button>
          </>}
          {detail.status !== 'archived' && <button disabled={busy} className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold" onClick={() => action(`${detail.id}/moderate`, { action: 'archive' })}>В архив</button>}
        </div>
        <ReasonModal isOpen={reasonAction === 'reject'} title="Причина отклонения" subject={detail.material_name}
          label="Причина отклонения" value={reason} maxLength={2000} submitLabel="Отклонить заявку"
          isSubmitting={busy} submitDisabled={!reason.trim()} onChange={setReason}
          onClose={() => { if (!busy) setReasonAction(null); }}
          onSubmit={e => { e.preventDefault(); void action(`${detail.id}/moderate`, { action: 'reject', reason: reason.trim() }).then(ok => { if (ok) setReasonAction(null); }); }} />
      </div>}
      {history.length > 0 && <div className="rounded-2xl bg-white p-4"><h3 className="mb-3 font-bold">История</h3>{history.map((h, i) => <p key={i} className="mb-2 text-sm text-slate-500">{dateTime(h.created_at)} · {states[h.status]} {h.reason && `— ${h.reason}`}</p>)}</div>}
    </> : <>
      <div className="rounded-3xl bg-gradient-to-br from-sky-500 to-sky-600 p-5 text-white shadow-sm"><ClipboardList className="mb-3 h-7 w-7" /><h2 className="text-xl font-extrabold">Найдите перевозчиков</h2><p className="mt-2 text-sm leading-relaxed text-sky-50">Разместите объём и условия. Партнёры свяжутся с вами и договорятся о перевозке.</p><button className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-sky-600" onClick={() => setEditing('new')}><Plus className="h-4 w-4" />Создать заявку</button></div>
      <div className="flex gap-1 overflow-x-auto rounded-2xl bg-white p-1">{[['all', 'Все'], ['favorites', 'Избранное'], ['mine', 'Мои заявки'], ...(role === 'admin' ? [['moderation', 'Модерация']] : [])].map(([id, label]) => <button key={id} className={`min-h-11 flex-1 whitespace-nowrap rounded-xl px-3 text-xs font-bold ${view === id ? 'bg-sky-50 text-sky-600' : 'text-slate-500'}`} onClick={() => { setView(id); setPage(1); }}>{label}</button>)}</div>
      <div className="space-y-3 rounded-2xl bg-white p-4"><label className="relative block"><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input className={`${inputClass} pl-9`} placeholder="Поиск материала" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></label><select aria-label="Город загрузки" className={inputClass} value={city} onChange={e => { setCity(e.target.value); setPage(1); }}><option value="">Все города загрузки</option>{cities.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-500">Сроки от<input type="date" className={`${inputClass} mt-1`} value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><label className="text-xs text-slate-500">До<input type="date" className={`${inputClass} mt-1`} value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label></div></div>

      {loading ? <div className="flex justify-center p-8"><Loader2 className="h-7 w-7 animate-spin text-sky-500" /></div> : error ? <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}<button className="ml-2 underline" onClick={() => load()}>Повторить</button></div> : !rows.length ? <div className="rounded-3xl bg-white p-10 text-center"><ClipboardList className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p className="font-bold">Заявок пока нет</p><p className="mt-2 text-sm text-slate-500">Попробуйте изменить фильтры или создайте свою.</p></div> : rows.map(row => <div key={row.id}><WholesaleRequestCard request={row} onOpen={() => void open(row)}
        headerAction={row.status === 'approved' ? <button disabled={busy} aria-label={row.is_favorite ? 'Убрать из избранного' : 'В избранное'} className="rounded-xl bg-slate-50 p-3" onClick={() => action(`${row.id}/favorite`, { enabled: !row.is_favorite }, 'PUT')}><Heart className={`h-5 w-5 ${row.is_favorite ? 'fill-sky-500 text-sky-500' : 'text-slate-400'}`} /></button> : undefined}
        footer={row.is_owner && row.status !== 'archived' ? <button className={buttonClass} onClick={() => setEditing(row)}>Редактировать</button> : undefined} /></div>)}
      {total > 20 && <div className="flex items-center justify-between"><button disabled={page === 1} className={buttonClass} onClick={() => setPage(page - 1)}>Назад</button><span className="text-sm text-slate-500">{page} / {Math.ceil(total / 20)}</span><button disabled={page * 20 >= total} className={buttonClass} onClick={() => setPage(page + 1)}>Далее</button></div>}
    </>}
  </CommerceShell>;
}

function WholesaleForm({ embedded, headerActions, request, initialCity, cities, onClose, onSaved }: { embedded: boolean; headerActions: ReactNode; request: Announcement | null; initialCity: string; cities: any[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>(request ? { ...request, material_id: request.material_id || '', vehicle_count: request.vehicle_count ?? '', contact_phone: formatPhoneNumber(request.contact_phone), comment: request.comment || '' } : blank(initialCity));
  const [materials, setMaterials] = useState<any[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsError, setMaterialsError] = useState(false);
  const [materialsRetry, setMaterialsRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setMaterialsLoading(true); setMaterialsError(false); setMaterials([]);
    const params = new URLSearchParams();
    if (form.city_id) params.set('city_id', form.city_id);
    fetch(`${baseURL}/catalog/materials/?${params}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error('Каталог недоступен'); return r.json(); })
      .then(rows => { if (!controller.signal.aborted) setMaterials(Array.isArray(rows) ? rows : []); })
      .catch(e => { if (e.name !== 'AbortError') setMaterialsError(true); })
      .finally(() => { if (!controller.signal.aborted) setMaterialsLoading(false); });
    return () => controller.abort();
  }, [form.city_id, materialsRetry]);
  const field = (name: string, value: string) => setForm((f: any) => ({ ...f, [name]: value }));
  const save = async () => {
    setBusy(true);
    try {
      const names = Object.keys(blank(''));
      const body = Object.fromEntries(names.map(key => [key, form[key]]));
      body.contact_phone = form.contact_phone.replace(/[^+\d]/g, '');
      body.material_id = form.material_id || null; body.vehicle_count = form.vehicle_count === '' || form.vehicle_count == null ? null : Number(form.vehicle_count);
      await commerceApi(`/wholesale-requests${request ? `/${request.id}` : ''}`, { method: request ? 'PUT' : 'POST', body: JSON.stringify(body) });
      toast.success('Заявка отправлена на модерацию'); onSaved();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const textFields = [['contact_name', 'Контактное лицо'], ['contact_phone', 'Телефон']] as const;
  return <CommerceShell embedded={embedded} headerActions={headerActions} title={request ? 'Редактировать заявку' : 'Новая оптовая заявка'} subtitle="Укажите объём, маршрут и условия перевозки" onClose={onClose}>
    <form className="space-y-4 rounded-3xl bg-white p-5 shadow-sm" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className="block text-sm font-semibold">Город загрузки<select aria-label="Город загрузки" required className={`${inputClass} mt-2`} value={form.city_id} onChange={e => { field('city_id', e.target.value); field('material_id', ''); field('material_name', ''); }}><option value="">Выберите город</option>{cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="block text-sm font-semibold">Материал<select aria-label="Материал" disabled={materialsLoading} className={`${inputClass} mt-2`} value={form.material_id} onChange={e => { field('material_id', e.target.value); const m = materials.find(m => m.id === e.target.value); field('material_name', m ? m.name : ''); }}><option value="">Указать название самостоятельно</option>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>{!form.material_id && <input required maxLength={255} className={`${inputClass} mt-2`} aria-label="Название материала" value={form.material_name} onChange={e => field('material_name', e.target.value)} />}{materialsLoading && <span className="mt-2 block text-xs text-slate-500">Загрузка материалов…</span>}{materialsError && <span className="mt-2 block text-xs text-red-700">Не удалось загрузить каталог. <button type="button" className="underline" onClick={() => setMaterialsRetry(n => n + 1)}>Повторить</button> или укажите название самостоятельно.</span>}</label>
      <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">Общий объём<input required type="number" min="0.001" max="999999999" step="0.001" className={`${inputClass} mt-2`} value={form.volume} onChange={e => field('volume', e.target.value)} /></label><label className="text-sm font-semibold">Единица<select className={`${inputClass} mt-2`} value={form.unit} onChange={e => field('unit', e.target.value)}><option value="m3">м³</option><option value="t">Тонны</option></select></label></div>
      <label className="block text-sm font-semibold">Количество машин (необязательно)<input aria-label="Количество машин (необязательно)" aria-describedby="wholesale-vehicle-count-hint" type="number" min="1" max="100000" step="1" className={`${inputClass} mt-2`} value={form.vehicle_count} onChange={e => field('vehicle_count', e.target.value)} /><span id="wholesale-vehicle-count-hint" className="mt-2 block text-xs font-normal text-slate-500">Заполните, если вам требуется конкретное количество техники на объекте</span></label>
      <CommerceAddressInput label="Место загрузки" value={form.pickup_address} city={cities.find(c => c.id === form.city_id)} onChange={value => field('pickup_address', value)} />
      <CommerceAddressInput label="Место доставки" value={form.delivery_address} city={cities.find(c => c.id === form.city_id)} allCities onChange={value => field('delivery_address', value)} />
      {textFields.map(([name, label]) => <label key={name} className="block text-sm font-semibold">{label}<input required type={name === 'contact_phone' ? 'tel' : 'text'} placeholder={name === 'contact_phone' ? '+7 (999) 999-99-99' : undefined} pattern={name === 'contact_phone' ? String.raw`\+7 \([0-9]{3}\) [0-9]{3}-[0-9]{2}-[0-9]{2}` : undefined} minLength={name === 'contact_phone' ? 18 : 1} maxLength={name.includes('address') ? 500 : name === 'contact_phone' ? 30 : 255} className={`${inputClass} mt-2`} value={form[name]} onChange={e => field(name, name === 'contact_phone' ? formatPhoneNumber(e.target.value) : e.target.value)} /></label>)}
      <div className="grid grid-cols-2 gap-3">{[['starts_on', 'Начало'], ['ends_on', 'Окончание']].map(([key, label]) => <label key={key} className="text-sm font-semibold">{label}<input required type="date" min={key === 'ends_on' ? form.starts_on : undefined} className={`${inputClass} mt-2`} value={form[key]} onChange={e => field(key, e.target.value)} /></label>)}</div>
      <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">Цена, ₽<input required type="number" min="0.01" max="99999999999" step="0.01" className={`${inputClass} mt-2`} value={form.price} onChange={e => field('price', e.target.value)} /></label><label className="text-sm font-semibold">За<select className={`${inputClass} mt-2`} value={form.price_basis} onChange={e => field('price_basis', e.target.value)}>{Object.entries(units).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label></div>
      <label className="block text-sm font-semibold">Комментарий<textarea maxLength={5000} className={`${inputClass} mt-2 min-h-28`} value={form.comment} onChange={e => field('comment', e.target.value)} /></label>
      <button disabled={busy} className={`${buttonClass} w-full`}>{busy ? "Сохранение…" : "Сохранить"}</button>
      <button type="button" className="w-full rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-600" onClick={() => setPreview(true)}>Предпросмотр</button>
      {preview && <div className="space-y-3"><WholesaleRequestCard request={{ ...form, status: undefined, reject_reason: null }} contactActions={false} /><button type="button" disabled={busy} className={`${buttonClass} w-full`} onClick={() => save()}>{busy ? 'Сохранение…' : 'Отправить на проверку'}</button></div>}
    </form>
  </CommerceShell>;
}
