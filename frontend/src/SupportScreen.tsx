import React, { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Headphones, MessageCircle, Plus, Send, X } from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage } from "./utils";

interface SupportMessage {
  id: string;
  author_name: string;
  author_role: string;
  text: string;
  created_at: string;
}

interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  context_type: string;
  context_id?: string | null;
  status: "new" | "in_progress" | "closed";
  requester_name: string;
  requester_phone?: string | null;
  requester_role: string;
  messages: SupportMessage[];
  created_at: string;
  updated_at: string;
}

const statusLabels = { new: "Новое", in_progress: "В работе", closed: "Закрыто" };
const statusClasses = { new: "bg-amber-100 text-amber-700", in_progress: "bg-sky-100 text-sky-700", closed: "bg-emerald-100 text-emerald-700" };
const requesterRoleLabels: Record<string, string> = { client: "Клиент", driver: "Водитель", admin: "Администратор", logist: "Логист", operator: "Оператор" };
const requesterRoleClasses: Record<string, string> = { client: "bg-slate-100 text-slate-600", driver: "bg-orange-100 text-orange-700", admin: "bg-violet-100 text-violet-700", logist: "bg-sky-100 text-sky-700", operator: "bg-emerald-100 text-emerald-700" };

interface MessageGroup {
  dayKey: string;
  date: Date;
  messages: SupportMessage[];
}

const messageDayKey = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

const groupMessagesByDay = (messages: SupportMessage[]) => messages.reduce<MessageGroup[]>((groups, message) => {
  const dayKey = messageDayKey(message.created_at);
  const currentGroup = groups.at(-1);
  if (currentGroup?.dayKey === dayKey) {
    currentGroup.messages.push(message);
    return groups;
  }
  groups.push({ dayKey, date: new Date(message.created_at), messages: [message] });
  return groups;
}, []);

const formatMessageDay = (date: Date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const messageDay = new Date(date);
  messageDay.setHours(0, 0, 0, 0);
  const differenceInDays = Math.round((today.getTime() - messageDay.getTime()) / 86_400_000);
  if (differenceInDays === 0) return "Сегодня";
  if (differenceInDays === 1) return "Вчера";
  return messageDay.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: messageDay.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
};

const formatMessageTime = (value: string) => new Date(value).toLocaleTimeString("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});
const getRequesterRoleLabel = (role: string) => requesterRoleLabels[role] || role;
const getRequesterRoleClass = (role: string) => requesterRoleClasses[role] || "bg-slate-100 text-slate-600";

interface Props {
  operatorMode?: boolean;
  onBack?: () => void;
  initialContext?: { type: string; id: string; subject?: string };
}

export default function SupportScreen({ operatorMode = false, onBack, initialContext }: Props) {
  const { token, role } = useAuthStore();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [filter, setFilter] = useState("");
  const [clientTab, setClientTab] = useState<"active" | "closed">("active");
  const [showCreate, setShowCreate] = useState(Boolean(initialContext));
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState("");
  const [form, setForm] = useState({
    subject: initialContext?.subject || "",
    category: "general",
    context_type: initialContext?.type || "general",
    context_id: initialContext?.id || "",
    message: "",
  });

  const endpoint = operatorMode ? `${baseURL}/admin/support/tickets` : `${baseURL}/support/tickets`;
  const headers = { Authorization: `Bearer ${token}` };
  const visibleTickets = operatorMode
    ? tickets
    : tickets.filter((ticket) =>
        clientTab === "active"
          ? ticket.status === "new" || ticket.status === "in_progress"
          : ticket.status === "closed",
      );

  const closeCreateForm = () => {
    if (initialContext && onBack) {
      onBack();
      return;
    }
    setShowCreate(false);
  };

  const load = async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      const query = operatorMode && filter ? `?status=${filter}` : "";
      const response = await fetch(`${endpoint}${query}`, { headers });
      if (!response.ok) throw new Error("load");
      const data: SupportTicket[] = await response.json();
      setTickets(data);
      if (selected) setSelected(data.find((item) => item.id === selected.id) || selected);
    } catch {
      if (!silent) toast.error("Не удалось загрузить обращения");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token, filter, operatorMode]);

  useEffect(() => {
    if (!selected) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`${endpoint}/${selected.id}`, { headers });
        if (response.ok) setSelected(await response.json());
      } catch {
        // Keep the current history while the connection is unavailable.
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [selected?.id, token, operatorMode]);

  const createTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      const payload = { ...form, context_id: form.context_type === "general" ? null : form.context_id };
      const response = await fetch(`${baseURL}/support/tickets`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось создать обращение"));
      setShowCreate(false);
      setForm({ subject: "", category: "general", context_type: "general", context_id: "", message: "" });
      setSelected(data);
      await load(true);
      toast.success("Обращение отправлено оператору");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать обращение");
    } finally {
      setSending(false);
    }
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const response = await fetch(`${endpoint}/${selected.id}/messages`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось отправить сообщение"));
      setSelected(data);
      setReply("");
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить сообщение");
    } finally {
      setSending(false);
    }
  };

  const moveStatus = async (nextStatus: "in_progress" | "closed") => {
    if (!selected) return;
    const response = await fetch(`${baseURL}/admin/support/tickets/${selected.id}/status`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(extractApiErrorMessage(data, "Не удалось изменить статус"));
    setSelected(data);
    await load(true);
  };

  if (selected) {
    const messageGroups = groupMessagesByDay(selected.messages);
    return (
      <div className="flex h-full min-h-[calc(100dvh-7rem)] flex-col overflow-hidden bg-slate-50 sm:min-h-full">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white p-4">
          <button onClick={() => setSelected(null)} className="rounded-full bg-slate-100 p-2"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1"><h2 className="truncate font-black text-slate-900">{selected.subject}</h2>{operatorMode ? <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>{selected.requester_name}{selected.requester_phone ? ` · ${selected.requester_phone}` : ""}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${getRequesterRoleClass(selected.requester_role)}`}>{getRequesterRoleLabel(selected.requester_role)}</span></div> : <p className="text-xs text-slate-500">Служба поддержки Дармавоза</p>}</div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClasses[selected.status]}`}>{statusLabels[selected.status]}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {messageGroups.map((group) => <section key={group.dayKey} className="space-y-3"><div className="sticky top-2 z-[5] flex justify-center py-2"><span className="rounded-full bg-slate-700/75 px-3 py-1 text-[11px] font-bold text-white shadow-sm backdrop-blur">{formatMessageDay(group.date)}</span></div>{group.messages.map((message) => {
            const mine = operatorMode ? ["admin", "logist"].includes(message.author_role) : message.author_role === role;
            const authorName = ["admin", "logist", "operator"].includes(message.author_role) ? "Поддержка" : message.author_name;
            return <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] rounded-2xl px-4 py-3 ${mine ? "bg-sky-500 text-white" : "bg-white text-slate-700 shadow-sm"}`}><p className="mb-1 text-[10px] font-bold opacity-70">{authorName}</p><p className="whitespace-pre-wrap text-sm">{message.text}</p><p className="mt-1 text-right text-[10px] opacity-60">{formatMessageTime(message.created_at)}</p></div></div>;
          })}</section>)}
        </div>
        {operatorMode && selected.status === "new" && <button onClick={() => void moveStatus("in_progress")} className="mx-4 mb-3 rounded-xl bg-amber-100 p-3 font-bold text-amber-700">Взять в работу</button>}
        {operatorMode && selected.status === "in_progress" && <button onClick={() => void moveStatus("closed")} className="mx-4 mb-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-100 p-3 font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Закрыть обращение</button>}
        {selected.status !== "closed" ? <form onSubmit={sendReply} className="mt-auto flex shrink-0 gap-2 border-t border-slate-100 bg-white p-4"><textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={1} placeholder="Сообщение..." className="min-h-12 flex-1 resize-none rounded-2xl bg-slate-100 p-3 outline-none" /><button disabled={sending || !reply.trim()} className="rounded-2xl bg-sky-500 p-3 text-white disabled:opacity-40"><Send className="h-5 w-5" /></button></form> : <p className="mt-auto shrink-0 border-t bg-white p-4 text-center text-sm text-slate-500">Обращение закрыто. История доступна только для чтения.</p>}
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 p-4">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">{onBack && <button onClick={onBack} className="rounded-full bg-white p-2 shadow-sm"><ArrowLeft className="h-5 w-5" /></button>}<div><h2 className="text-2xl font-black">{operatorMode ? "Панель поддержки" : "Поддержка"}</h2><p className="text-sm text-slate-500">{operatorMode ? "Обращения пользователей" : "Напишите оператору Дармавоза"}</p></div></div>
        {!operatorMode && <button onClick={() => setShowCreate(true)} className="rounded-2xl bg-sky-500 p-3 text-white"><Plus className="h-5 w-5" /></button>}
      </div>
      {operatorMode && <div className="mb-4 flex gap-2 overflow-x-auto">{[["", "Все"], ["new", "Новые"], ["in_progress", "В работе"], ["closed", "Закрытые"]].map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${filter === value ? "bg-sky-500 text-white" : "bg-white text-slate-600"}`}>{label}</button>)}</div>}
      {!operatorMode && <div className="mb-4 flex gap-2 overflow-x-auto"><button onClick={() => setClientTab("active")} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${clientTab === "active" ? "bg-sky-500 text-white" : "bg-white text-slate-600"}`}>Активные</button><button onClick={() => setClientTab("closed")} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${clientTab === "closed" ? "bg-sky-500 text-white" : "bg-white text-slate-600"}`}>Закрытые</button></div>}
      {loading ? <p className="py-16 text-center text-slate-400">Загрузка...</p> : visibleTickets.length === 0 ? <div className="rounded-3xl bg-white p-10 text-center shadow-sm"><Headphones className="mx-auto h-12 w-12 text-sky-300" /><p className="mt-3 font-bold text-slate-700">Обращений пока нет</p>{!operatorMode && <button onClick={() => setShowCreate(true)} className="mt-4 rounded-xl bg-sky-500 px-5 py-3 font-bold text-white">Написать оператору</button>}</div> : <div className="space-y-3">{visibleTickets.map((ticket) => <button key={ticket.id} onClick={() => setSelected(ticket)} className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm"><div className="rounded-xl bg-sky-50 p-3"><MessageCircle className="h-5 w-5 text-sky-500" /></div><div className="min-w-0 flex-1"><p className="truncate font-bold">{ticket.subject}</p>{operatorMode ? <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="truncate">{ticket.requester_name}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${getRequesterRoleClass(ticket.requester_role)}`}>{getRequesterRoleLabel(ticket.requester_role)}</span></div> : <p className="truncate text-xs text-slate-500">{ticket.messages.at(-1)?.text}</p>}</div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusClasses[ticket.status]}`}>{statusLabels[ticket.status]}</span></button>)}</div>}
      {showCreate && <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"><form onSubmit={createTicket} className="w-full max-w-md rounded-t-3xl bg-white p-5 sm:rounded-3xl"><div className="mb-5 flex justify-between"><div><p className="text-xs font-bold text-sky-600">НОВОЕ ОБРАЩЕНИЕ</p><h3 className="text-xl font-black">Написать оператору</h3></div><button type="button" onClick={closeCreateForm} className="rounded-full bg-slate-100 p-2"><X className="h-5 w-5" /></button></div><div className="space-y-4"><label className="block text-sm font-bold">Тема<input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal" /></label><label className="block text-sm font-bold">Категория<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"><option value="general">Общий вопрос</option><option value="order">Заказ</option><option value="pickup_point">Точка забора</option><option value="equipment">Спецтехника</option><option value="participant">Участник системы</option></select></label><label className="block text-sm font-bold">Сообщение<textarea required rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="mt-1 w-full resize-none rounded-xl bg-slate-100 p-3 font-normal" /></label></div><button disabled={sending} className="mt-5 w-full rounded-2xl bg-sky-500 p-4 font-bold text-white disabled:opacity-50">{sending ? "Отправляем..." : "Отправить"}</button></form></div>}
    </div>
  );
}
