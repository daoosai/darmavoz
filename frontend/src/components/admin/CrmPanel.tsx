import { useEffect, useState } from "react";
import { Link2, Loader2, Save } from "lucide-react";
import toast from "react-hot-toast";

import { CRM_STATUS_LABELS, type CrmStatus } from "../../crmStatus";
import { baseURL, extractApiErrorMessage } from "../../utils";

type PointKind = "quarry" | "water";
type Owner = { id: string; display_name?: string | null; username?: string | null; phone?: string | null };

export default function CrmPanel({
  token,
  pointKind,
  pointId,
  initialStatus,
  initialComment,
  initialOwnerId,
  onUpdated,
}: {
  token: string | null;
  pointKind: PointKind;
  pointId?: string;
  initialStatus?: CrmStatus | null;
  initialComment?: string | null;
  initialOwnerId?: string | null;
  onUpdated?: () => void | Promise<void>;
}) {
  const [crmStatus, setCrmStatus] = useState<CrmStatus>(initialStatus || "parsed");
  const [crmComment, setCrmComment] = useState(initialComment || "");
  const [ownerId, setOwnerId] = useState(initialOwnerId || "");
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(false);

  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  useEffect(() => {
    setCrmStatus(initialStatus || "parsed");
    setCrmComment(initialComment || "");
    setOwnerId(initialOwnerId || "");
  }, [initialComment, initialOwnerId, initialStatus, pointId]);

  useEffect(() => {
    if (!token || !pointId) return;
    const ownerRole = pointKind === "quarry" ? "supplier" : "water_septic_partner";
    void fetch(`${baseURL}/admin/users?role=${ownerRole}`, { headers })
      .then(async (response) => response.ok ? response.json() : [])
      .then((data) => setOwners(Array.isArray(data) ? data : []));
  }, [pointId, pointKind, token]);

  if (!pointId) return null;

  const saveCrm = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(`${baseURL}/admin/crm/${pointKind}/${pointId}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ crm_status: crmStatus, crm_comment: crmComment || null }),
      });
      if (!response.ok) throw new Error(await extractApiErrorMessage(response, "Не удалось сохранить CRM-статус"));
      toast.success("CRM-статус сохранён");
      await onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить CRM-статус");
    } finally {
      setLoading(false);
    }
  };

  const bindOwner = async () => {
    if (!token || !ownerId) return;
    setLoading(true);
    try {
      const response = await fetch(`${baseURL}/admin/crm/${pointKind}/${pointId}/owner`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ owner_user_id: ownerId }),
      });
      if (!response.ok) throw new Error(await extractApiErrorMessage(response, "Не удалось привязать владельца"));
      toast.success("Владелец привязан, статус — «Согласовано»");
      setCrmStatus("agreed");
      await onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось привязать владельца");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h4 className="font-black text-slate-900">CRM-статус, комментарий и владелец</h4>
      <label className="block text-sm font-bold">CRM Статус
        <select value={crmStatus} onChange={(event) => setCrmStatus(event.target.value as CrmStatus)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal">
          {(Object.keys(CRM_STATUS_LABELS) as CrmStatus[]).map((status) => <option key={status} value={status}>{CRM_STATUS_LABELS[status]}</option>)}
        </select>
      </label>
      <label className="block text-sm font-bold">Комментарий
        <textarea value={crmComment} onChange={(event) => setCrmComment(event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal" />
      </label>
      <button type="button" disabled={loading || !token} onClick={() => void saveCrm()} className="flex items-center justify-center gap-2 rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Сохранить CRM
      </button>
      <div className="border-t border-slate-200 pt-4">
        <label className="block text-sm font-bold">Привязать владельца
          <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal">
            <option value="">Выберите существующий аккаунт</option>
            {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.display_name || owner.username || owner.phone || owner.id}</option>)}
          </select>
        </label>
        <button type="button" disabled={loading || !ownerId || !token} onClick={() => void bindOwner()} className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Привязать владельца
        </button>
      </div>
    </section>
  );
}
