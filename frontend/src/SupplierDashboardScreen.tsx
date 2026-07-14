import { useEffect, useState } from "react";
import { Building2, Loader2, LogOut, MapPin, Plus, Upload } from "lucide-react";
import toast from "react-hot-toast";

import { logoutCurrentSession } from "./pushAuth";
import SupplierCreatePointModal from "./SupplierCreatePointModal";
import { baseURL, extractApiErrorMessage } from "./utils";

const STATUS_LABELS: Record<string, string> = {
  incomplete: "Черновик",
  pending_moderation: "На модерации",
  approved: "Одобрено",
  rejected: "Отклонено",
  suspended: "Приостановлено",
};

const TYPE_LABELS: Record<string, string> = {
  quarry: "Карьер",
  accumulator: "Накопитель",
  warehouse: "База / склад",
  supplier: "Поставщик",
};

interface Props {
  token: string;
  onBack: () => void;
}

export default function SupplierDashboardScreen({ token, onBack }: Props) {
  const [points, setPoints] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [showCreatePoint, setShowCreatePoint] = useState(false);

  const fetchPoints = async () => {
    try {
      const response = await fetch(`${baseURL}/supplier/points`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось загрузить точки"));
      setPoints(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить точки");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchPoints();
  }, [token]);

  const uploadPhoto = async (pointId: string, file: File) => {
    setIsBusy(true);
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST",
        headers,
        body: JSON.stringify({ file_name: file.name, content_type: file.type, file_size: file.size, entity_type: "quarry", entity_id: pointId, is_primary: true }),
      });
      const presign = await presignResponse.json().catch(() => ({}));
      if (!presignResponse.ok) throw new Error(extractApiErrorMessage(presign, "Не удалось подготовить загрузку"));
      const storageResponse = await fetch(presign.upload_url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!storageResponse.ok) throw new Error("Не удалось загрузить фотографию");
      const confirmResponse = await fetch(`${baseURL}/media/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({ entity_type: "quarry", entity_id: pointId, object_key: presign.object_key, file_name: file.name, content_type: file.type, file_size: file.size, is_primary: true }),
      });
      if (!confirmResponse.ok) throw new Error("Не удалось подтвердить фотографию");
      await fetchPoints();
      toast.success("Фотография добавлена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить фотографию");
    } finally {
      setIsBusy(false);
    }
  };

  const submitPoint = async (pointId: string) => {
    setIsBusy(true);
    try {
      const response = await fetch(`${baseURL}/supplier/points/${pointId}/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Карточка заполнена не полностью"));
      await fetchPoints();
      toast.success("Точка отправлена на модерацию");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить точку");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 sm:max-w-md sm:mx-auto">
      <header className="flex items-center justify-between px-5 pb-4 pt-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-500">Кабинет поставщика</p>
          <h1 className="mt-1 text-3xl font-black">Мои точки</h1>
        </div>
        <button
          onClick={async () => {
            await logoutCurrentSession();
            onBack();
          }}
          className="rounded-full bg-white p-3 text-gray-700 shadow-sm hover:bg-gray-100"
          aria-label="Выйти"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      <main className="px-5 pb-12">
        <button onClick={() => setShowCreatePoint(true)} className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl bg-sky-500 px-5 py-5 text-lg font-black text-white shadow-sm hover:bg-sky-600">
          <Plus className="h-6 w-6" /> Добавить точку забора
        </button>

        {isLoading ? (
          <Loader2 className="mx-auto mt-16 h-8 w-8 animate-spin text-sky-500" />
        ) : points.length === 0 ? (
          <section className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
            <Building2 className="mx-auto h-12 w-12 text-gray-300" />
            <h2 className="mt-5 text-xl font-black">Точек пока нет</h2>
            <p className="mt-2 text-sm text-gray-500">Добавьте первый карьер или накопитель. Каждая точка проходит модерацию отдельно.</p>
          </section>
        ) : (
          <div className="mt-8 space-y-4">
            {points.map((point) => (
              <article key={point.id} className="overflow-hidden rounded-2xl bg-white shadow-sm">
                {point.primary_image_url ? <img src={point.primary_image_url} alt="" className="h-36 w-full object-cover" /> : null}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-sky-500">{TYPE_LABELS[point.point_type] || point.point_type}</p>
                      <h2 className="mt-1 text-xl font-black">{point.name}</h2>
                    </div>
                    <span className="rounded-full bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600">{STATUS_LABELS[point.moderation_status] || point.moderation_status}</span>
                  </div>
                  <p className="mt-3 flex items-start gap-2 text-sm text-gray-500"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{point.address || `${point.lat}, ${point.lon}`}</p>
                  {point.moderation_comment ? <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{point.moderation_comment}</p> : null}
                  <div className="mt-5 flex gap-2">
                    <label className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-gray-200 py-3 text-sm font-bold hover:bg-gray-50">
                      <Upload className="mr-2 h-4 w-4" /> Фото
                      <input type="file" accept="image/*" className="hidden" onChange={(event) => event.target.files?.[0] && void uploadPhoto(point.id, event.target.files[0])} />
                    </label>
                    <button disabled={isBusy || point.moderation_status === "pending_moderation"} onClick={() => void submitPoint(point.id)} className="flex-1 rounded-xl bg-sky-500 px-3 py-3 text-sm font-bold text-white hover:bg-sky-600 disabled:opacity-40">
                      На модерацию
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {showCreatePoint ? (
        <SupplierCreatePointModal
          token={token}
          onClose={() => setShowCreatePoint(false)}
          onCreated={(point) => {
            setPoints((current) => [point, ...current]);
            setShowCreatePoint(false);
          }}
        />
      ) : null}
    </div>
  );
}
