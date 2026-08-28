import { useEffect, useState } from "react";
import { Link2, Loader2, Save } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage } from "../../utils";

type PointKind = "quarry" | "water";

type Owner = { id: string; display_name?: string | null; username?: string | null; phone?: string | null };

export default function CrmPanel({ token, pointKind, pointId, initialComment, initialOwnerId, onUpdated }: {
  token: string | null;
  pointKind: PointKind;
  pointId?: string;
  initialComment?: string | null;
  initialOwnerId?: string | null;
  onUpdated?: () => void | Promise<void>;
}) {
  const [crmComment, setCrmComment] = useState(initialComment || "");
  const [ownerId, setOwnerId] = useState(initialOwnerId || "");
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(false);

  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const load = async () => {
    if (!token || !pointId) return;
    const ownerRole = pointKind === "quarry" ? "supplier" : "water_septic_partner";
    const ownersResponse = await fetch(`${baseURL}/admin/users?role=${ownerRole}`, { headers });
    if (ownersResponse.ok) setOwners(await ownersResponse.json());
  };

  useEffect(() => { void load(); }, [pointId, pointKind, token]);

  if (!pointId) return null;

  const saveComment = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(`${baseURL}/admin/crm/${pointKind}/${pointId}`, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ crm_comment: crmComment || null }) });
      if (!response.ok) throw new Error(await extractApiErrorMessage(response, "Не удалось сохранить комментарий"));
      toast.success("Комментарий сохранён");
      await onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить комментарий");
    } finally { setLoading(false); }
  };

  const bindOwner = async () => {
    if (!token || !ownerId) return;
    setLoading(true);
    try {
      const response = await fetch(`${baseURL}/admin/crm/${pointKind}/${pointId}/owner`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ owner_user_id: ownerId }) });
      if (!response.ok) throw new Error(await extractApiErrorMessage(response, "Не удалось привязать владельца"));
      toast.success("Владелец привязан, точка активирована");
      await onUpdated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось привязать владельца");
    } finally { setLoading(false); }
  };

  return <section className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <h4 className="font-black text-slate-900">Комментарий и владелец</h4>
    <label className="block text-sm font-bold">Комментарий<textarea value={crmComment} onChange={(event) => setCrmComment(event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal" /></label>
    <button type="button" disabled={loading || !token} onClick={() => void saveComment()} className="flex items-center justify-center gap-2 rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />Сохранить комментарий</button>
    <div className="border-t border-slate-200 pt-4"><label className="block text-sm font-bold">Привязать владельца<select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal"><option value="">Выберите существующий аккаунт</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.display_name || owner.username || owner.phone || owner.id}</option>)}</select></label><button type="button" disabled={loading || !ownerId || !token} onClick={() => void bindOwner()} className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Привязать владельца</button></div>
  </section>;
}
