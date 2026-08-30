import type { CrmStatus } from "../../crmStatus";
import { baseURL, extractApiErrorMessage } from "../../utils";

type PointKind = "quarry" | "water";

export const savePointCrm = async ({
  token,
  pointKind,
  pointId,
  status,
  comment,
  ownerId,
  initialStatus,
  initialComment,
  initialOwnerId,
}: {
  token: string | null;
  pointKind: PointKind;
  pointId: string;
  status: CrmStatus;
  comment: string;
  ownerId: string;
  initialStatus: CrmStatus;
  initialComment: string;
  initialOwnerId: string;
}) => {
  if (!token) return null;
  const normalizedComment = comment.trim() || null;
  const ownerChanged = ownerId !== initialOwnerId;
  const statusChanged = status !== initialStatus;
  const commentChanged = normalizedComment !== (initialComment.trim() || null);

  if (ownerChanged && ownerId) {
    const ownerResponse = await fetch(`${baseURL}/admin/crm/${pointKind}/${pointId}/owner`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ owner_user_id: ownerId }),
    });
    const ownerData = await ownerResponse.json().catch(() => ({}));
    if (!ownerResponse.ok) {
      throw new Error(extractApiErrorMessage(ownerData, "Не удалось сохранить владельца"));
    }
  }

  if (!statusChanged && !commentChanged && !(ownerChanged && ownerId)) return null;

  const crmResponse = await fetch(`${baseURL}/admin/crm/${pointKind}/${pointId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ crm_status: status, crm_comment: normalizedComment }),
  });
  const crmData = await crmResponse.json().catch(() => ({}));
  if (!crmResponse.ok) {
    throw new Error(extractApiErrorMessage(crmData, "Не удалось сохранить статус и комментарий"));
  }
  return crmData as { crm_status: CrmStatus; crm_comment?: string | null; owner_user_id?: string | null };
};
