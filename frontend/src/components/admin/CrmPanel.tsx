import { useEffect, useState } from "react";

import { CRM_STATUS_LABELS, type CrmStatus } from "../../crmStatus";
import { baseURL } from "../../utils";

type PointKind = "quarry" | "water";
type Owner = { id: string; display_name?: string | null; username?: string | null; phone?: string | null };
const CRM_STATUS_KEYS: CrmStatus[] = [
  "auto_added",
  "invite_sent",
  "response_received",
  "interested",
  "registered",
  "registration_completed",
  "activated",
  "refused",
  "call_later",
];

export default function CrmPanel({
  token,
  pointKind,
  pointId,
  status,
  comment,
  ownerId,
  onStatusChange,
  onCommentChange,
  onOwnerChange,
}: {
  token: string | null;
  pointKind: PointKind;
  pointId?: string;
  status: CrmStatus;
  comment: string;
  ownerId: string;
  onStatusChange: (status: CrmStatus) => void;
  onCommentChange: (comment: string) => void;
  onOwnerChange: (ownerId: string) => void;
}) {
  const [owners, setOwners] = useState<Owner[]>([]);

  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  useEffect(() => {
    if (!token || !pointId) return;
    const ownerRole = pointKind === "quarry" ? "supplier" : "water_septic_partner";
    void fetch(`${baseURL}/admin/users?role=${ownerRole}`, { headers })
      .then(async (response) => response.ok ? response.json() : [])
      .then((data) => setOwners(Array.isArray(data) ? data : []));
  }, [pointId, pointKind, token]);

  if (!pointId) return null;

  return (
    <section className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h4 className="font-black text-slate-900">Статус, комментарий и владелец</h4>
      <label className="block text-sm font-bold">Статус
        <select value={status} onChange={(event) => {
          const nextStatus = event.target.value as CrmStatus;
          if (CRM_STATUS_KEYS.includes(nextStatus)) onStatusChange(nextStatus);
        }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal">
          {CRM_STATUS_KEYS.map((status) => <option key={status} value={status}>{CRM_STATUS_LABELS[status]}</option>)}
        </select>
      </label>
      <label className="block text-sm font-bold">Комментарий
        <textarea value={comment} onChange={(event) => onCommentChange(event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal" />
      </label>
      <div className="border-t border-slate-200 pt-4">
        <label className="block text-sm font-bold">Привязать владельца
          <select value={ownerId} onChange={(event) => onOwnerChange(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal">
            <option value="">Выберите существующий аккаунт</option>
            {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.display_name || owner.username || owner.phone || owner.id}</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}
