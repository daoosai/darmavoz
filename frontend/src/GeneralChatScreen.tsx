import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pin, Send, Shield, Trash2 } from 'lucide-react';
import CommerceShell from './CommerceShell';
import SubscriptionsScreen from './SubscriptionsScreen';
import { buttonClass, commerceApi, dateTime, inputClass } from './commerceApi';
interface Message { id: number; account_id: string; author: string; text: string | null; deleted: boolean; pinned: boolean; created_at: string }
interface Member { id: string; name: string; banned: boolean; removed: boolean; moderator: boolean; muted_until: string | null }
interface Room { messages: Message[]; changes: { action: string; message_id: number | null }[]; audit_cursor: number; rules: string; can_moderate: boolean; is_admin: boolean; muted_until: string | null; pins: Message[] }
interface Audit { id: string; action: string; reason: string; created_at: string; actor_id: string }
const actions: Record<string, string> = { warn: 'Предупредить', mute: 'Ограничить отправку', unmute: 'Разрешить отправку', ban: 'Заблокировать', unban: 'Разблокировать', remove: 'Удалить из чата', restore: 'Вернуть в чат', set_moderator: 'Назначить модератором', unset_moderator: 'Снять права модератора', delete: 'Удалить сообщение', pin: 'Закрепить', unpin: 'Открепить', rules: 'Обновить правила' };
export default function GeneralChatScreen({ onClose }: { onClose: () => void }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subscriptions, setSubscriptions] = useState(false);
  const [moderation, setModeration] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState('');
  const [audit, setAudit] = useState<Audit[]>([]);
  const [action, setAction] = useState('warn');
  const [target, setTarget] = useState('');
  const [messageId, setMessageId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [rules, setRules] = useState('');
  const [hasOlder, setHasOlder] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const initialScroll = useRef(true);
  const latestMessage = useRef(0);
  const [newMessages, setNewMessages] = useState(false);
  const scrollBottom = () => { setNewMessages(false); requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })); };
  const cursor = useRef(0);
  const pending = useRef<{ text: string; id: string } | null>(null);
  const merge = (rows: Message[]) => setMessages(old => [...new Map([...old, ...rows].map(x => [x.id, x])).values()].sort((a, b) => a.id - b.id));
  const load = useCallback(async () => {
    try {
      const data: Room = await commerceApi(`/chat/messages?after_audit=${cursor.current}&after=${latestMessage.current}`);
      const scroller = endRef.current?.closest('section.fixed');
      const atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 200;
      const last = data.messages.at(-1)?.id || 0;
      const incoming = last > latestMessage.current;
      latestMessage.current = Math.max(last, latestMessage.current);
      setMessages(old => {
        let next = [...new Map([...old, ...data.messages].map(x => [x.id, x])).values()];
        for (const change of data.changes) next = next.map(m => m.id !== change.message_id ? m : change.action === 'delete' ? { ...m, text: null, deleted: true, pinned: false } : { ...m, pinned: change.action === 'pin' });
        return next.sort((a, b) => a.id - b.id);
      });
      cursor.current = data.audit_cursor; setRoom(data); setDenied(false); setError('');
      if (initialScroll.current || (incoming && atBottom)) { initialScroll.current = false; scrollBottom(); }
      else if (incoming) setNewMessages(true);
    } catch (e) {
      if (e instanceof Error && 'status' in e && [401, 403, 409].includes(Number(e.status))) { setMessages([]); setRoom(null); cursor.current = 0; initialScroll.current = true; latestMessage.current = 0; setDenied('code' in e && e.code === 'CHAT_SUBSCRIPTION_REQUIRED'); setMembers([]); setAudit([]); }
      throw e;
    }
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => { if (active) void load().catch(e => active && setError(e.message)); };
    refresh(); const timer = window.setInterval(refresh, 5000); window.addEventListener('online', refresh); window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); };
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие'); } finally { setBusy(false); } };
  const send = () => run(async () => {
    if (pending.current?.text !== text.trim()) pending.current = { text: text.trim(), id: crypto.randomUUID() };
    const row = await commerceApi('/chat/messages', { method: 'POST', body: JSON.stringify({ text: pending.current.text, request_id: pending.current.id }) });
    merge([row]); pending.current = null; setText(''); scrollBottom();
  });
  const chooseAction = (value: string, m: Message) => { setModeration(true); setAction(value); setMessageId(m.id); setReason(''); };
  const loadMembers = async () => { setMembers(await commerceApi(`/chat/members?q=${encodeURIComponent(query)}`)); if (room?.is_admin) setAudit(await commerceApi('/chat/audit')); };
  const apply = () => run(async () => {
    await commerceApi('/chat/moderation', { method: 'POST', body: JSON.stringify({ action, target_id: ['delete', 'pin', 'unpin', 'rules'].includes(action) ? null : target || null, message_id: messageId, reason, until: action === 'mute' && until ? new Date(until).toISOString() : null, rules: action === 'rules' ? rules : null }) });
    setReason(''); await loadMembers();
  });
  return <CommerceShell title="Общий чат" subtitle="Сообщество Дармавоза" onClose={onClose}>
    {error && <div role="alert" className="space-y-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900"><p className="whitespace-pre-line break-words">{error}</p><button disabled={busy} className={buttonClass} onClick={() => void run(load)}>Повторить</button>{denied && <button className={`${buttonClass} ml-2`} onClick={() => setSubscriptions(true)}>Выбрать подписку</button>}</div>}
    {!room && !error && <p role="status" className="flex gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Загрузка чата…</p>}
    {room && <>
      {room.rules && <section className="rounded-2xl bg-sky-50 p-4 text-sm text-sky-900"><h2 className="font-bold">Правила чата</h2><p className="mt-2 whitespace-pre-wrap break-words">{room.rules}</p></section>}
      {room.pins.length > 0 && <section className="space-y-2 rounded-2xl bg-amber-50 p-4"><h2 className="flex items-center gap-2 text-sm font-bold"><Pin className="h-4 w-4" />Закреплённое</h2>{room.pins.map(m => <p key={m.id} className="whitespace-pre-wrap break-words text-sm">{m.author}: {m.text}</p>)}</section>}
      {room.can_moderate && <button className="flex min-h-11 items-center gap-2 text-sm font-bold text-sky-600" onClick={() => { setModeration(!moderation); setRules(room.rules); void run(loadMembers); }}><Shield className="h-4 w-4" />Управление чатом</button>}
      {moderation && room.can_moderate && <section className="space-y-3 rounded-2xl border border-sky-100 bg-white p-4"><h2 className="font-bold">Модерация</h2><form className="flex gap-2" onSubmit={e => { e.preventDefault(); void run(loadMembers); }}><input className={inputClass} aria-label="Поиск участников" placeholder="Имя участника" value={query} onChange={e => setQuery(e.target.value)} /><button className={buttonClass} disabled={busy}>Найти</button></form>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void apply(); }}><label className="block text-xs text-slate-500">Участник<select className={`${inputClass} mt-1`} value={target} onChange={e => setTarget(e.target.value)}><option value="">Выберите участника</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}{m.moderator ? ' · модератор' : ''}{m.banned ? ' · блокировка' : ''}{m.removed ? ' · удалён' : ''}{m.muted_until ? ` · ограничен до ${dateTime(m.muted_until)}` : ''}</option>)}</select></label><label className="block text-xs text-slate-500">Действие<select className={`${inputClass} mt-1`} value={action} onChange={e => setAction(e.target.value)}>{Object.entries(actions).filter(([key]) => room.is_admin || !['rules', 'set_moderator', 'unset_moderator'].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {['delete', 'pin', 'unpin'].includes(action) && <label className="block text-xs text-slate-500">Номер сообщения<input required type="number" min={1} className={inputClass} value={messageId ?? ''} onChange={e => setMessageId(Number(e.target.value))} /></label>}
        {action === 'mute' && <label className="block text-xs text-slate-500">Ограничить до<input required type="datetime-local" className={inputClass} value={until} onChange={e => setUntil(e.target.value)} /></label>}
        {action === 'rules' && <textarea maxLength={4000} className={inputClass} aria-label="Правила чата" rows={5} value={rules} onChange={e => setRules(e.target.value)} />}
        <textarea required minLength={3} maxLength={500} className={inputClass} aria-label="Причина действия модератора" placeholder="Причина (обязательно)" value={reason} onChange={e => setReason(e.target.value)} /><button disabled={busy} className={buttonClass}>Применить</button></form>
        {room.is_admin && <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">Журнал модерации</summary><div className="max-h-80 space-y-2 overflow-y-auto">{audit.length === 0 && <p className="text-sm text-slate-500">Действий пока нет</p>}{audit.map(a => <article key={a.id} className="rounded-xl bg-slate-50 p-3 text-xs"><p>{actions[a.action] || a.action} · {dateTime(a.created_at)}</p><p className="mt-1 break-words">{a.reason}</p><p className="mt-1 break-all text-slate-400">Сотрудник: {a.actor_id}</p></article>)}</div></details>}
      </section>}
      {messages.length > 0 && hasOlder && <button disabled={busy} className="min-h-11 text-sm font-bold text-sky-600" onClick={() => void run(async () => { const older: Room = await commerceApi(`/chat/messages?before=${messages[0].id}`); merge(older.messages); setHasOlder(older.messages.length === 50); })}>Загрузить предыдущие</button>}
      {newMessages && <button className="min-h-11 rounded-xl bg-sky-50 px-3 text-sm font-bold text-sky-700" onClick={scrollBottom}>Новые сообщения · к последним</button>}
      <section aria-label="Сообщения чата" className="space-y-3">{messages.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-slate-500">Сообщений пока нет. Начните общение.</p>}{messages.map(m => <article key={m.id} className="min-w-0 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><p className="break-words text-xs font-bold text-sky-700">{m.author}</p><p className={`mt-2 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere] ${m.deleted ? 'italic text-slate-400' : 'text-slate-800'}`}>{m.deleted ? 'Сообщение удалено модератором' : m.text}</p><p className="mt-2 text-[10px] text-slate-400">{dateTime(m.created_at)} · #{m.id}{m.pinned ? ' · закреплено' : ''}</p>{room.can_moderate && !m.deleted && <div className="mt-2 flex flex-wrap gap-3"><button aria-label={`Удалить сообщение ${m.id}`} className="flex min-h-11 items-center gap-1 text-xs text-red-600" onClick={() => chooseAction('delete', m)}><Trash2 className="h-4 w-4" />Удалить</button><button className="flex min-h-11 items-center gap-1 text-xs text-sky-600" onClick={() => chooseAction(m.pinned ? 'unpin' : 'pin', m)}><Pin className="h-4 w-4" />{m.pinned ? 'Открепить' : 'Закрепить'}</button></div>}</article>)}</section>
      <form className="sticky bottom-0 space-y-2 rounded-2xl border border-slate-100 bg-white p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-sm" onSubmit={e => { e.preventDefault(); void send(); }}>{room.muted_until && new Date(room.muted_until) > new Date() && <p className="text-xs text-amber-700">Отправка ограничена до {dateTime(room.muted_until)}</p>}<div className="flex items-end gap-2"><textarea disabled={busy} required aria-label="Сообщение" rows={2} maxLength={4000} className={`${inputClass} max-h-40 resize-y`} placeholder="Написать сообщение…" value={text} onChange={e => setText(e.target.value)} /><button aria-label="Отправить сообщение" disabled={busy || !text.trim() || Boolean(room.muted_until && new Date(room.muted_until) > new Date())} className={`${buttonClass} shrink-0 px-3`}><Send className="h-5 w-5" /></button></div><p className="text-right text-[10px] text-slate-400">{text.length}/4000</p></form><div ref={endRef} aria-hidden="true" />
    </>}
    {subscriptions && <SubscriptionsScreen onClose={() => { setSubscriptions(false); void run(load); }} />}
  </CommerceShell>;
}
