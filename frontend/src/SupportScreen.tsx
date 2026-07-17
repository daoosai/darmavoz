import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CheckCircle2,
  Headphones,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import toast from "react-hot-toast";

import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage, resolveMediaUrl } from "./utils";

interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_id?: string | null;
  author_client_id?: string | null;
  author_user_id?: string | null;
  author_name: string;
  author_role: string;
  text: string;
  attachment_url?: string | null;
  is_read: boolean;
  is_own: boolean;
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

const sortTicketsByUpdatedAt = (items: SupportTicket[]) =>
  [...items].sort(
    (left, right) =>
      new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );

const withoutMessage = (ticket: SupportTicket, messageId: string): SupportTicket => ({
  ...ticket,
  messages: ticket.messages.filter((message) => message.id !== messageId),
});

const statusLabels = { new: "Новое", in_progress: "В работе", closed: "Закрыто" };
const statusClasses = {
  new: "bg-amber-100 text-amber-700",
  in_progress: "bg-sky-100 text-sky-700",
  closed: "bg-emerald-100 text-emerald-700",
};
const requesterRoleLabels: Record<string, string> = {
  client: "Клиент",
  driver: "Водитель",
  admin: "Администратор",
  logist: "Логист",
  operator: "Оператор",
};
const requesterRoleClasses: Record<string, string> = {
  client: "bg-slate-100 text-slate-600",
  driver: "bg-orange-100 text-orange-700",
  admin: "bg-violet-100 text-violet-700",
  logist: "bg-sky-100 text-sky-700",
  operator: "bg-emerald-100 text-emerald-700",
};
const operatorAuthorRoles = new Set(["admin", "logist", "operator"]);

interface MessageGroup {
  dayKey: string;
  date: Date;
  messages: SupportMessage[];
}

const messageDayKey = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

const groupMessagesByDay = (messages: SupportMessage[]) =>
  messages.reduce<MessageGroup[]>((groups, message) => {
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

const formatMessageTime = (value: string) =>
  new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

const getRequesterRoleLabel = (role: string) => requesterRoleLabels[role] || role;
const getRequesterRoleClass = (role: string) =>
  requesterRoleClasses[role] || "bg-slate-100 text-slate-600";
const getMessageSenderId = (message: SupportMessage) =>
  message.sender_id || message.author_client_id || message.author_user_id || null;
const getSupportActorId = (
  messages: SupportMessage[],
  currentRole: string | null,
) => {
  if (currentRole === "client") {
    return messages.find((message) => message.author_client_id)?.author_client_id || null;
  }
  if (currentRole === "driver") {
    return (
      messages.find(
        (message) => message.author_role === "driver" && message.author_user_id,
      )?.author_user_id ||
      messages.find((message) => message.is_own && message.author_user_id)?.author_user_id ||
      null
    );
  }
  return messages.find((message) => message.is_own && message.author_user_id)?.author_user_id || null;
};

interface Props {
  operatorMode?: boolean;
  onBack?: () => void;
  initialContext?: { type: string; id: string; subject?: string };
}

export default function SupportScreen({
  operatorMode = false,
  onBack,
  initialContext,
}: Props) {
  const { token, role } = useAuthStore();
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const messageMenuButtonRef = useRef<HTMLDivElement | null>(null);
  const messageMenuDropdownRef = useRef<HTMLDivElement | null>(null);
  const lastReadRequestRef = useRef<string | null>(null);
  const hiddenMessageIdsRef = useRef(new Set<string>());
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [filter, setFilter] = useState("");
  const [clientTab, setClientTab] = useState<"active" | "closed">("active");
  const [showCreate, setShowCreate] = useState(Boolean(initialContext));
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState("");
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const [openedMessageMenuId, setOpenedMessageMenuId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<SupportMessage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [messageActionLoading, setMessageActionLoading] = useState(false);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
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

  const syncTicket = (ticket: SupportTicket) => {
    const hiddenMessageIds = hiddenMessageIdsRef.current;
    const visibleTicket = hiddenMessageIds.size > 0
      ? {
          ...ticket,
          messages: ticket.messages.filter((message) => !hiddenMessageIds.has(message.id)),
        }
      : ticket;

    setSelected(visibleTicket);
    setTickets((current) =>
      sortTicketsByUpdatedAt([
        visibleTicket,
        ...current.filter((item) => item.id !== visibleTicket.id),
      ]),
    );
  };

  const isOperatorViewer = operatorMode || operatorAuthorRoles.has(role || "");
  const isIncomingMessage = (message: SupportMessage) =>
    isOperatorViewer
      ? !operatorAuthorRoles.has(message.author_role)
      : operatorAuthorRoles.has(message.author_role);

  const getUnreadIncomingSignature = (ticket: SupportTicket) => {
    const unreadIncomingIds = ticket.messages
      .filter((message) => isIncomingMessage(message) && !message.is_read)
      .map((message) => message.id);

    return unreadIncomingIds.length > 0
      ? `${ticket.id}:${unreadIncomingIds.join(",")}`
      : null;
  };

  const hasUnreadClientMessages = (ticket: SupportTicket) =>
    ticket.messages.some(
      (message) =>
        !message.is_read && !["admin", "logist", "operator"].includes(message.author_role),
    );

  const clearAttachment = () => {
    setSelectedAttachment(null);
    setAttachmentPreviewUrl((current) => {
      if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
      return null;
    });
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  };

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
      setSelected((current) =>
        current ? data.find((item) => item.id === current.id) || current : null,
      );
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
        if (response.ok) syncTicket(await response.json());
      } catch {
        // Keep the current history while the connection is unavailable.
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [selected?.id, token, operatorMode, filter]);

  useEffect(() => {
    clearAttachment();
    setReply("");
    setOpenedMessageMenuId(null);
    setEditingMessage(null);
    lastReadRequestRef.current = null;
  }, [selected?.id]);

  useEffect(() => {
    return () => {
      if (attachmentPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(attachmentPreviewUrl);
    };
  }, [attachmentPreviewUrl]);

  useEffect(() => {
    if (!openedMessageMenuId || typeof document === "undefined") return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (
        messageMenuButtonRef.current &&
        target instanceof Node &&
        !messageMenuButtonRef.current.contains(target) &&
        !messageMenuDropdownRef.current?.contains(target)
      ) {
        setOpenedMessageMenuId(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [openedMessageMenuId]);

  useEffect(() => {
    if (!lightboxImageUrl || typeof window === "undefined") return;

    const handlePopState = () => {
      setLightboxImageUrl(null);
    };

    window.history.pushState(
      { ...(window.history.state || {}), supportLightbox: true },
      "",
      window.location.href,
    );
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [lightboxImageUrl]);

  const unreadIncomingSignature = selected ? getUnreadIncomingSignature(selected) : null;

  useEffect(() => {
    if (!selected || !token || !unreadIncomingSignature) {
      if (!selected || !unreadIncomingSignature) {
        lastReadRequestRef.current = null;
      }
      return;
    }
    if (lastReadRequestRef.current === unreadIncomingSignature) return;

    lastReadRequestRef.current = unreadIncomingSignature;
    const controller = new AbortController();

    const markRead = async () => {
      try {
        const response = await fetch(`${baseURL}/support/tickets/${selected.id}/read`, {
          method: "PATCH",
          headers,
          signal: controller.signal,
        });
        if (!response.ok) return;

        const ticket: SupportTicket = await response.json();
        syncTicket(ticket);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    };

    void markRead();
    return () => controller.abort();
  }, [selected?.id, token, unreadIncomingSignature]);

  const closeLightbox = () => {
    if (typeof window !== "undefined" && window.history.state?.supportLightbox) {
      window.history.back();
      return;
    }
    setLightboxImageUrl(null);
  };

  const createTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      const payload = {
        ...form,
        context_id: form.context_type === "general" ? null : form.context_id,
      };
      const response = await fetch(`${baseURL}/support/tickets`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось создать обращение"));
      }
      setShowCreate(false);
      setForm({
        subject: "",
        category: "general",
        context_type: "general",
        context_id: "",
        message: "",
      });
      syncTicket(data);
      toast.success("Обращение отправлено оператору");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать обращение");
    } finally {
      setSending(false);
    }
  };

  const uploadSupportAttachment = async (ticketId: string, file: File) => {
    const fileName = file.name || `support-${Date.now()}.jpg`;
    const contentType = file.type || "image/jpeg";

    const presignResponse = await fetch(
      `${baseURL}/support/tickets/${ticketId}/attachments/presign-upload`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: fileName,
          content_type: contentType,
          file_size: file.size,
        }),
      },
    );
    const presignData = await presignResponse.json().catch(() => ({}));
    if (!presignResponse.ok) {
      throw new Error(
        extractApiErrorMessage(presignData, "Не удалось подготовить загрузку файла"),
      );
    }

    const uploadResponse = await fetch(presignData.upload_url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
    if (!uploadResponse.ok) {
      throw new Error("Не удалось загрузить изображение в хранилище");
    }

    const confirmResponse = await fetch(
      `${baseURL}/support/tickets/${ticketId}/attachments/confirm`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          object_key: presignData.object_key,
          file_name: fileName,
          content_type: contentType,
          file_size: file.size,
        }),
      },
    );
    const confirmData = await confirmResponse.json().catch(() => ({}));
    if (!confirmResponse.ok) {
      throw new Error(
        extractApiErrorMessage(confirmData, "Не удалось подтвердить загрузку файла"),
      );
    }
    return confirmData.public_url as string;
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextText = reply.trim();
    if (!selected) return;
    if (editingMessage ? !nextText : !nextText && !selectedAttachment) return;
    setSending(true);
    try {
      const response = editingMessage
        ? await fetch(`${baseURL}/support/messages/${editingMessage.id}`, {
            method: "PATCH",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ text: nextText }),
          })
        : await fetch(`${endpoint}/${selected.id}/messages`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              text: nextText || null,
              attachment_url: selectedAttachment
                ? await uploadSupportAttachment(selected.id, selectedAttachment)
                : null,
            }),
          });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось отправить сообщение"));
      }
      syncTicket(data);
      setReply("");
      setEditingMessage(null);
      setEditingMessageId(null);
      setEditingText("");
      clearAttachment();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить сообщение");
    } finally {
      setSending(false);
    }
  };

  const startEditingMessage = (message: SupportMessage) => {
    setOpenedMessageMenuId(null);
    clearAttachment();
    setEditingMessage(message);
    setReply(message.text);
    setEditingMessageId(null);
    setEditingText(message.text);
  };

  const cancelEditingMessage = () => {
    setEditingMessage(null);
    setReply("");
    setEditingMessageId(null);
    setEditingText("");
  };

  const saveEditedMessage = async (messageId: string) => {
    const nextText = editingText.trim();
    if (!nextText) {
      toast.error("Введите текст сообщения");
      return;
    }

    setMessageActionLoading(true);
    try {
      const response = await fetch(`${baseURL}/support/messages/${messageId}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ text: nextText }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось изменить сообщение"));
      }
      syncTicket(data);
      cancelEditingMessage();
      toast.success("Сообщение обновлено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить сообщение");
    } finally {
      setMessageActionLoading(false);
    }
  };

  const removeMessage = async (messageId: string) => {
    if (!window.confirm("Удалить сообщение?")) return;

    const ticketBeforeDelete = selected;
    hiddenMessageIdsRef.current.add(messageId);
    setOpenedMessageMenuId(null);
    setMessageActionLoading(true);
    setSelected((current) => (current ? withoutMessage(current, messageId) : current));
    setTickets((current) =>
      current.map((ticket) => withoutMessage(ticket, messageId)),
    );
    try {
      const response = await fetch(`${baseURL}/support/messages/${messageId}`, {
        method: "DELETE",
        headers,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось удалить сообщение"));
      }
      syncTicket(data);
      if (editingMessage?.id === messageId || editingMessageId === messageId) {
        cancelEditingMessage();
      }
      toast.success("Сообщение удалено");
    } catch (error) {
      hiddenMessageIdsRef.current.delete(messageId);
      if (ticketBeforeDelete) syncTicket(ticketBeforeDelete);
      toast.error(error instanceof Error ? error.message : "Не удалось удалить сообщение");
    } finally {
      setMessageActionLoading(false);
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
    if (!response.ok) {
      return toast.error(extractApiErrorMessage(data, "Не удалось изменить статус"));
    }
    syncTicket(data);
  };

  const currentSupportActorId = selected ? getSupportActorId(selected.messages, role) : null;
  const lightbox = typeof document !== "undefined"
    ? createPortal(
        <AnimatePresence>
          {lightboxImageUrl ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeLightbox}
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/95 p-4"
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  closeLightbox();
                }}
                className="absolute right-5 top-5 z-10 rounded-full bg-black/35 p-4 text-white shadow-2xl transition hover:bg-black/55"
              >
                <X className="h-8 w-8" />
              </button>
              <motion.div
                drag="y"
                dragDirectionLock
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.22 }}
                onClick={(event) => event.stopPropagation()}
                onDragEnd={(_event, info) => {
                  if (info.offset.y > 120 || info.velocity.y > 700) {
                    closeLightbox();
                  }
                }}
                className="flex max-h-full max-w-full items-center justify-center"
              >
                <img
                  src={lightboxImageUrl}
                  alt="Вложение"
                  className="max-h-[88vh] max-w-full rounded-3xl object-contain shadow-2xl"
                />
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )
    : null;

  const createTicketModal =
    showCreate && typeof document !== "undefined"
      ? createPortal(
          <div
            onClick={closeCreateForm}
            className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 sm:items-center"
          >
            <div
              onClick={(event) => event.stopPropagation()}
              className="relative mx-4 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 p-4">
                <div>
                  <p className="text-xs font-bold text-sky-600">НОВОЕ ОБРАЩЕНИЕ</p>
                  <h3 className="text-xl font-black">Написать оператору</h3>
                </div>
                <button
                  type="button"
                  onClick={closeCreateForm}
                  className="rounded-full bg-slate-100 p-2"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={createTicket} className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                  <label className="block text-sm font-bold">
                    Тема
                    <input
                      required
                      value={form.subject}
                      onChange={(event) => setForm({ ...form, subject: event.target.value })}
                      className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                    />
                  </label>
                  <label className="block text-sm font-bold">
                    Категория
                    <select
                      value={form.category}
                      onChange={(event) => setForm({ ...form, category: event.target.value })}
                      className="mt-1 w-full rounded-xl bg-slate-100 p-3 font-normal"
                    >
                      <option value="general">Общий вопрос</option>
                      <option value="order">Заказ</option>
                      <option value="pickup_point">Точка забора</option>
                      <option value="equipment">Спецтехника</option>
                      <option value="participant">Участник системы</option>
                    </select>
                  </label>
                  <label className="block text-sm font-bold">
                    Сообщение
                    <textarea
                      required
                      rows={5}
                      value={form.message}
                      onChange={(event) => setForm({ ...form, message: event.target.value })}
                      className="mt-1 w-full resize-none rounded-xl bg-slate-100 p-3 font-normal"
                    />
                  </label>
                </div>

                <div className="border-t border-slate-100 p-4">
                  <button
                    disabled={sending}
                    className="w-full rounded-2xl bg-sky-500 p-4 font-bold text-white disabled:opacity-50"
                  >
                    {sending ? "Отправляем..." : "Отправить"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )
      : null;

  if (selected) {
    const messageGroups = groupMessagesByDay(selected.messages);
    return (
      <div className="flex h-full min-h-[calc(100dvh-7rem)] flex-col overflow-hidden bg-slate-50 sm:min-h-full">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white p-4">
          <button
            onClick={() => setSelected(null)}
            className="rounded-full bg-slate-100 p-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-black text-slate-900">{selected.subject}</h2>
            {operatorMode ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>
                  {selected.requester_name}
                  {selected.requester_phone ? ` · ${selected.requester_phone}` : ""}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${getRequesterRoleClass(selected.requester_role)}`}
                >
                  {getRequesterRoleLabel(selected.requester_role)}
                </span>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Служба поддержки Дармавоза</p>
            )}
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${statusClasses[selected.status]}`}
          >
            {statusLabels[selected.status]}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {selected.messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-slate-400">
              Сообщений пока нет
            </div>
          ) : (
            messageGroups.map((group) => (
              <section key={group.dayKey} className="space-y-3">
                <div className="sticky top-2 z-[5] flex justify-center py-2">
                  <span className="rounded-full bg-slate-700/75 px-3 py-1 text-[11px] font-bold text-white shadow-sm backdrop-blur">
                    {formatMessageDay(group.date)}
                  </span>
                </div>
                {group.messages.map((message) => {
                  const senderId = getMessageSenderId(message);
                  const mine = Boolean(message.is_own) || (
                    currentSupportActorId ? senderId === currentSupportActorId : false
                  );
                  const authorName = operatorAuthorRoles.has(message.author_role)
                    ? "Поддержка"
                    : message.author_name;
                  const resolvedAttachmentUrl =
                    resolveMediaUrl(message.attachment_url) || message.attachment_url;
                  const isEditing = editingMessageId === message.id;

                  return (
                    <div
                      key={message.id}
                      className={`flex ${mine ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`relative max-w-[85%] px-4 py-3 ${
                          mine
                            ? "rounded-2xl rounded-br-sm bg-blue-500 pr-11 text-white"
                            : "rounded-2xl rounded-bl-sm bg-white text-black shadow-sm"
                        }`}
                      >
                        {!mine ? (
                          <p className="mb-1 text-[10px] font-bold text-slate-500">
                            {authorName}
                          </p>
                        ) : null}

                        {mine && selected.status !== "closed" ? (
                          <div
                            ref={openedMessageMenuId === message.id ? messageMenuButtonRef : undefined}
                            className="absolute right-2 top-2"
                          >
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenedMessageMenuId((current) =>
                                  current === message.id ? null : message.id,
                                );
                              }}
                              className={`rounded-full p-1.5 ${
                                mine ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </div>
                        ) : null}

                        {openedMessageMenuId === message.id ? (
                          <div
                            ref={openedMessageMenuId === message.id ? messageMenuDropdownRef : undefined}
                            className="absolute right-2 top-11 z-10 w-44 overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-xl"
                          >
                            <button
                              type="button"
                              onClick={() => startEditingMessage(message)}
                              className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold transition hover:bg-slate-50"
                            >
                              <Pencil className="h-4 w-4" />
                              Изменить
                            </button>
                            <button
                              type="button"
                              disabled={messageActionLoading}
                              onClick={() => void removeMessage(message.id)}
                              className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
                              Удалить
                            </button>
                          </div>
                        ) : null}

                        {resolvedAttachmentUrl ? (
                          <button
                            type="button"
                            onClick={() => setLightboxImageUrl(resolvedAttachmentUrl)}
                            className="mb-2 block overflow-hidden rounded-2xl"
                          >
                            <img
                              src={resolvedAttachmentUrl}
                              alt="Вложение"
                              className="max-h-64 w-full max-w-xs rounded-2xl object-cover transition duration-200 hover:scale-[1.01]"
                            />
                          </button>
                        ) : null}

                        {isEditing ? (
                          <div className="space-y-2">
                            <textarea
                              autoFocus
                              rows={4}
                              value={editingText}
                              onChange={(event) => setEditingText(event.target.value)}
                              className="w-full resize-none rounded-2xl border border-white/30 bg-white/10 p-3 text-sm text-inherit outline-none placeholder:text-white/60"
                              placeholder="Текст сообщения"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={cancelEditingMessage}
                                className={`rounded-xl px-3 py-2 text-xs font-bold ${
                                  mine ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                Отмена
                              </button>
                              <button
                                type="button"
                                disabled={messageActionLoading || !editingText.trim()}
                                onClick={() => void saveEditedMessage(message.id)}
                                className={`rounded-xl px-3 py-2 text-xs font-bold ${
                                  mine
                                    ? "bg-white text-sky-600 disabled:bg-white/70"
                                    : "bg-sky-500 text-white disabled:opacity-50"
                                }`}
                              >
                                Сохранить
                              </button>
                            </div>
                          </div>
                        ) : message.text.trim() ? (
                          <p className="whitespace-pre-wrap text-sm">{message.text}</p>
                        ) : null}

                        <div
                          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                            mine ? "text-white/75" : "text-slate-400"
                          }`}
                        >
                          <span>{formatMessageTime(message.created_at)}</span>
                          {mine ? (
                            message.is_read ? (
                              <CheckCheck className="h-3.5 w-3.5 text-cyan-100" />
                            ) : (
                              <Check className="h-3.5 w-3.5 text-white/60" />
                            )
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>

        {operatorMode && selected.status === "new" && (
          <button
            onClick={() => void moveStatus("in_progress")}
            className="mx-4 mb-3 rounded-xl bg-amber-100 p-3 font-bold text-amber-700"
          >
            Взять в работу
          </button>
        )}
        {operatorMode && selected.status === "in_progress" && (
          <button
            onClick={() => void moveStatus("closed")}
            className="mx-4 mb-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-100 p-3 font-bold text-emerald-700"
          >
            <CheckCircle2 className="h-4 w-4" />
            Закрыть обращение
          </button>
        )}

        {selected.status !== "closed" ? (
          <form
            onSubmit={sendReply}
            className="mt-auto shrink-0 border-t border-slate-100 bg-white p-4"
          >
            {editingMessage ? (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-sky-600">
                    Редактирование
                  </p>
                  <p className="truncate text-sm font-medium text-slate-700">
                    {editingMessage.text}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={cancelEditingMessage}
                  className="rounded-full bg-white p-2 text-slate-500 shadow-sm transition hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            {attachmentPreviewUrl && !editingMessage ? (
              <div className="mb-3 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <img
                  src={attachmentPreviewUrl}
                  alt="Предпросмотр вложения"
                  className="h-16 w-16 rounded-xl object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-700">
                    {selectedAttachment?.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    1 фото будет отправлено вместе с сообщением
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearAttachment}
                  className="rounded-full bg-white p-2 text-slate-500 shadow-sm"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            <div className="flex gap-2">
              <input
                ref={attachmentInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (!file.type.startsWith("image/")) {
                    toast.error("Можно прикрепить только изображение");
                    event.target.value = "";
                    return;
                  }
                  if (file.size > 10 * 1024 * 1024) {
                    toast.error("Изображение должно быть не больше 10 МБ");
                    event.target.value = "";
                    return;
                  }
                  setSelectedAttachment(file);
                  setAttachmentPreviewUrl((current) => {
                    if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
                    return URL.createObjectURL(file);
                  });
                }}
              />
              <button
                type="button"
                disabled={Boolean(editingMessage)}
                onClick={() => attachmentInputRef.current?.click()}
                className="rounded-2xl bg-slate-100 p-3 text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Paperclip className="h-5 w-5" />
              </button>
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                rows={1}
                placeholder="Сообщение..."
                className="min-h-12 flex-1 resize-none rounded-2xl bg-slate-100 p-3 outline-none"
              />
              <button
                disabled={sending || (editingMessage ? !reply.trim() : !reply.trim() && !selectedAttachment)}
                className="rounded-2xl bg-sky-500 p-3 text-white disabled:opacity-40"
              >
                {editingMessage ? <Check className="h-5 w-5" /> : <Send className="h-5 w-5" />}
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-auto shrink-0 border-t bg-white p-4 text-center text-sm text-slate-500">
            Обращение закрыто. История доступна только для чтения.
          </p>
        )}
        {lightbox}
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 p-4">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="rounded-full bg-white p-2 shadow-sm">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div>
            <h2 className="text-2xl font-black">
              {operatorMode ? "Панель поддержки" : "Поддержка"}
            </h2>
            <p className="text-sm text-slate-500">
              {operatorMode ? "Обращения пользователей" : "Напишите оператору Дармавоза"}
            </p>
          </div>
        </div>
        {!operatorMode && (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-2xl bg-sky-500 p-3 text-white"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}
      </div>

      {operatorMode && (
        <div className="mb-4 flex gap-2 overflow-x-auto">
          {[["", "Все"], ["new", "Новые"], ["in_progress", "В работе"], ["closed", "Закрытые"]].map(
            ([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
                  filter === value ? "bg-sky-500 text-white" : "bg-white text-slate-600"
                }`}
              >
                {label}
              </button>
            ),
          )}
        </div>
      )}

      {!operatorMode && (
        <div className="mb-4 flex gap-2 overflow-x-auto">
          <button
            onClick={() => setClientTab("active")}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
              clientTab === "active" ? "bg-sky-500 text-white" : "bg-white text-slate-600"
            }`}
          >
            Активные
          </button>
          <button
            onClick={() => setClientTab("closed")}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
              clientTab === "closed" ? "bg-sky-500 text-white" : "bg-white text-slate-600"
            }`}
          >
            Закрытые
          </button>
        </div>
      )}

      {loading ? (
        <p className="py-16 text-center text-slate-400">Загрузка...</p>
      ) : visibleTickets.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
          <Headphones className="mx-auto h-12 w-12 text-sky-300" />
          <p className="mt-3 font-bold text-slate-700">Обращений пока нет</p>
          {!operatorMode && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 rounded-xl bg-sky-500 px-5 py-3 font-bold text-white"
            >
              Написать оператору
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleTickets.map((ticket) => (
            <button
              key={ticket.id}
              onClick={() => setSelected(ticket)}
              className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm"
            >
              <div className="rounded-xl bg-sky-50 p-3">
                <MessageCircle className="h-5 w-5 text-sky-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p
                    className={`truncate font-bold ${
                      operatorMode && hasUnreadClientMessages(ticket) ? "text-slate-950" : ""
                    }`}
                  >
                    {ticket.subject}
                  </p>
                  {operatorMode && hasUnreadClientMessages(ticket) ? (
                    <span className="shrink-0 rounded-full bg-rose-500 px-2 py-1 text-[10px] font-bold text-white">
                      Новое сообщение
                    </span>
                  ) : null}
                </div>
                {operatorMode ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="truncate">{ticket.requester_name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${getRequesterRoleClass(ticket.requester_role)}`}
                    >
                      {getRequesterRoleLabel(ticket.requester_role)}
                    </span>
                  </div>
                ) : (
                  <p className="truncate text-xs text-slate-500">
                    {ticket.messages.at(-1)?.text || (ticket.messages.at(-1)?.attachment_url ? "Фото во вложении" : "")}
                  </p>
                )}
              </div>
              <span
                className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusClasses[ticket.status]}`}
              >
                {statusLabels[ticket.status]}
              </span>
            </button>
          ))}
        </div>
      )}

      {createTicketModal}

      {lightboxImageUrl ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/90 p-4">
          <button
            type="button"
            onClick={() => setLightboxImageUrl(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxImageUrl}
            alt="Вложение"
            className="max-h-full max-w-full rounded-3xl object-contain shadow-2xl"
          />
        </div>
      ) : null}
    </div>
  );
}
