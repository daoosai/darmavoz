import { useEffect, useState } from "react";
import { Link2, Loader2, Save } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage } from "../../utils";

type PointKind = "quarry" | "water";
type CrmStatus = "parsed" | "active" | "rejected";

type Owner = { id: string; display_name?: string | null; username?: string | null; phone?: string | null };
type AuditEntry = { id: string; old_status?: CrmStatus | null; new_status: CrmStatus; created_at: string };

const labels: Record<CrmStatus, string> = { parsed: "Распарсена", active: "Активна", rejected: "Отклонена" };

export default function CrmPanel({ token, pointKind, pointId, initialStatus, initialComment, initialOwnerId, onUpdated }: {
  token: string | null;
  pointKind: PointKind;
  pointId?: string;
  initialStatus?: CrmStatus;
  initialComment?: string | null;
  initialOwnerId?: string | null;
  onUpdated?: () => void | Promise<void>;
}) {
  const [crmStatus, setCrmStatus] = useState<CrmStatus>(initialStatus || "active");
  const [crmComment, setCrmComment] = useState(initialComment || "");
  const [ownerId, setOwnerId] = useState(initialOwnerId || "");
  const [owners, setOwners] = useState<Owner[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const load = async () => {
    if (!token || !pointId) return;
    const ownerRole = pointKind === "quarry" ? "supplier" : "water_septic_partner";
    const [ownersResponse, auditResponse] = await Promise.all([
      fetch(`${baseURL}/admin/users?role=${ownerRole}`, { headers }),
      fetch(`${baseURL}/admin/crm/${pointKind}/${pointId}/audit-log`, { headers }),
    ]);
    if (ownersResponse.ok) setOwners(await ownersResponse.json());
    if (auditResponse.ok) setAudit(await auditResponse.json());
  };

  useEffect(() => { void load(); }, [pointId, pointKind, token]);

  if (!pointId) return null;

  const saveCrm = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(`${baseURL}/admin/crm/${pointKind}/${pointId}`, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ crm_status: crmStatus, crm_comment: crmComment || null }) });
      if (!response.ok) throw new Error(await extractApiErrorMessage(response, "Не удалось сохранить CRM"));
      toast.success("CRM сохранена");
      await load();
      await onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить CRM");
    } finally { setLoading(false); }
  };

  const bindOwner = async () => {
    if (!token || !ownerId) return;
    setLoading(true);
    try {
      const response = await fetch(`${baseURL}/admin/crm/${pointKind}/${pointId}/owner`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ owner_user_id: ownerId }) });
      if (!response.ok) throw new Error(await extractApiErrorMessage(response, "Не удалось привязать владельца"));
      setCrmStatus("active");
      toast.success("Владелец привязан, точка активирована");
      await load();
      await onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось привязать владельца");
    } finally { setLoading(false); }
  };

  return <section className="mt-5 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <h4 className="font-black text-slate-900">CRM</h4>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Статус<select value={crmStatus} onChange={(event) => setCrmStatus(event.target.value as CrmStatus)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal">{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-bold">Комментарий<textarea value={crmComment} onChange={(event) => setCrmComment(event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal" /></label></div>
    <button type="button" disabled={loading || !token} onClick={() => void saveCrm()} className="flex items-center justify-center gap-2 rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />Сохранить CRM</button>
    <div className="border-t border-slate-200 pt-3"><label className="block text-sm font-bold">Привязать владельца<select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal"><option value="">Выберите существующий аккаунт</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.display_name || owner.username || owner.phone || owner.id}</option>)}</select></label><button type="button" disabled={loading || !ownerId || !token} onClick={() => void bindOwner()} className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Привязать владельца</button></div>
    <div className="border-t border-slate-200 pt-3"><p className="text-sm font-bold text-slate-700">История статусов</p>{audit.length ? <ul className="mt-2 space-y-1 text-xs text-slate-600">{audit.map((entry) => <li key={entry.id}>{entry.old_status ? `${labels[entry.old_status]} → ` : "Создана → "}{labels[entry.new_status]} · {new Date(entry.created_at).toLocaleString("ru-RU")}</li>)}</ul> : <p className="mt-1 text-xs text-slate-500">Изменений пока нет.</p>}</div>
  </section>;
}
