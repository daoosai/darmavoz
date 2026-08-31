import { useEffect, useState } from "react";
import { Bell, CheckCheck, Loader2, X } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage } from "../../utils";

interface InboxNotification {
  id: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at?: string | null;
}

export default function NotificationCenter({ token }: { token: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  const loadUnread = async () => {
    if (!token) return;
    const response = await fetch(`${baseURL}/notifications/unread-count`, { headers });
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    setUnread(Number(data.count) || 0);
  };

  const loadItems = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(`${baseURL}/notifications?limit=50`, { headers });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось загрузить уведомления"));
      setItems(Array.isArray(data) ? data : []);
      setUnread(Array.isArray(data) ? data.filter((item) => !item.is_read).length : 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить уведомления");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUnread();
    const interval = window.setInterval(() => void loadUnread(), 60000);
    return () => window.clearInterval(interval);
  }, [token]);

  const open = () => {
    setIsOpen(true);
    void loadItems();
  };

  const markAllRead = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${baseURL}/notifications/read-all`, { method: "POST", headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось обновить уведомления"));
      setItems((current) => current.map((item) => ({ ...item, is_read: true })));
      setUnread(0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить уведомления");
    }
  };

  const markRead = async (notificationId: string) => {
    const item = items.find((notification) => notification.id === notificationId);
    if (!token || !item || item.is_read) return;

    try {
      const response = await fetch(
        `${baseURL}/notifications/${notificationId}/read`,
        { method: "PATCH", headers },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось обновить уведомление"));
      }
      setItems((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? { ...notification, is_read: true }
            : notification,
        ),
      );
      setUnread((current) => Math.max(0, current - 1));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось обновить уведомление",
      );
    }
  };

  return <>
    <button type="button" onClick={open} className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-sky-50 text-sky-600" aria-label="Открыть уведомления">
      <Bell className="h-6 w-6" />
      {unread > 0 ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-xs font-black leading-5 text-white">{unread > 99 ? "99+" : unread}</span> : null}
    </button>
    {isOpen ? <div className="fixed inset-0 z-[99999] flex justify-end bg-slate-900/30" role="dialog" aria-modal="true" aria-label="Центр уведомлений">
      <div className="relative z-[100000] flex h-full w-full max-w-md flex-col bg-slate-50 shadow-2xl">
        <header className="flex items-center justify-between border-b bg-white px-4 pb-4 pt-[max(env(safe-area-inset-top),2.5rem)]"><div><h2 className="text-lg font-black">Уведомления</h2><p className="text-sm text-slate-500">Новые заявки и события</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => void markAllRead()} className="rounded-lg p-2 text-sky-600" aria-label="Прочитать все"><CheckCheck /></button><button type="button" onClick={() => setIsOpen(false)} className="rounded-lg p-2 text-slate-600" aria-label="Закрыть"><X /></button></div></header>
        <div className="flex-1 overflow-y-auto p-4">{loading ? <Loader2 className="mx-auto mt-8 animate-spin text-sky-500" /> : null}{!loading && items.length === 0 ? <p className="rounded-2xl bg-white p-4 text-sm text-slate-500">У вас пока нет уведомлений.</p> : null}<div className="space-y-3">{items.map((item) => <button type="button" key={item.id} onClick={() => void markRead(item.id)} className={`block w-full rounded-2xl p-4 text-left shadow-sm transition-colors ${item.is_read ? "bg-white" : "bg-sky-50 ring-1 ring-sky-200 hover:bg-sky-100"}`}><h3 className="font-bold text-slate-900">{item.title}</h3><p className="mt-1 text-sm text-slate-600">{item.body}</p>{item.created_at ? <time className="mt-2 block text-xs text-slate-400">{new Date(item.created_at).toLocaleString("ru-RU")}</time> : null}</button>)}</div></div>
      </div>
    </div> : null}
  </>;
}
