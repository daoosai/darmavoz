import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, LogOut, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { logoutCurrentSession, switchAuthenticatedSession } from "./pushAuth";
import { useAuthStore } from "./store";
import { baseURL, extractApiErrorMessage } from "./utils";

const STATUS_LABELS: Record<string, string> = {
  incomplete: "Черновик",
  pending_moderation: "На модерации",
  approved: "Одобрено",
  rejected: "Отклонено",
  suspended: "Приостановлено",
};

export default function SupplierPortalScreen({ onBack }: { onBack: () => void }) {
  const { token, role } = useAuthStore();
  const [points, setPoints] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [form, setForm] = useState({
    phone: "", password: "", name: "", short_name: "", point_type: "quarry",
    address: "", description: "", lat: 57.152223, lon: 65.527202,
    material_id: "", price: "",
  });

  const fetchPoints = async () => {
    if (!token) return;
    const response = await fetch(`${baseURL}/supplier/points`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) setPoints(await response.json());
  };

  useEffect(() => {
    fetch(`${baseURL}/catalog/materials/`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setMaterials(Array.isArray(data) ? data : []));
  }, []);

  useEffect(() => {
    if (role === "supplier") void fetchPoints();
  }, [role, token]);

  const register = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    try {
      const response = await fetch(`${baseURL}/auth/supplier/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: form.phone, password: form.password, name: form.name,
          short_name: form.short_name || null, point_type: form.point_type,
          address: form.address, description: form.description || null,
          lat: Number(form.lat), lon: Number(form.lon),
          material_offers: [{ material_id: form.material_id, price: Number(form.price), is_active: true }],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Не удалось отправить код"));
      setOtpPhone(data.phone);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsBusy(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsBusy(true);
    try {
      const response = await fetch(`${baseURL}/auth/supplier/register/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: otpPhone, code: otpCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(extractApiErrorMessage(data, "Неверный код"));
      await switchAuthenticatedSession(data.access_token, "supplier");
      setPoints([data.point]);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsBusy(false);
    }
  };

  const uploadPhoto = async (pointId: string, file: File) => {
    if (!token) return;
    setIsBusy(true);
    try {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST", headers,
        body: JSON.stringify({ file_name: file.name, content_type: file.type, file_size: file.size, entity_type: "quarry", entity_id: pointId, is_primary: true }),
      });
      const presign = await presignResponse.json();
      if (!presignResponse.ok) throw new Error(extractApiErrorMessage(presign, "Не удалось подготовить загрузку"));
      const storageResponse = await fetch(presign.upload_url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!storageResponse.ok) throw new Error("Не удалось загрузить фотографию");
      const confirm = await fetch(`${baseURL}/media/confirm`, {
        method: "POST", headers,
        body: JSON.stringify({ entity_type: "quarry", entity_id: pointId, object_key: presign.object_key, file_name: file.name, content_type: file.type, file_size: file.size, is_primary: true }),
      });
      if (!confirm.ok) throw new Error("Не удалось подтвердить фотографию");
      await fetchPoints();
      toast.success("Фотография добавлена");
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsBusy(false);
    }
  };

  const submitPoint = async (pointId: string) => {
    if (!token) return;
    const response = await fetch(`${baseURL}/supplier/points/${pointId}/submit`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(extractApiErrorMessage(data, "Заявка заполнена не полностью"));
    await fetchPoints();
    toast.success("Заявка отправлена на модерацию");
  };

  if (role === "supplier" && token) {
    return (
      <div className="min-h-screen bg-[#f4f1e8] sm:max-w-md sm:mx-auto p-5">
        <header className="flex items-center justify-between mb-8">
          <div><p className="text-xs uppercase tracking-[0.16em] text-stone-500">Кабинет</p><h1 className="text-2xl font-bold text-[#163f35]">Мои точки</h1></div>
          <button onClick={async () => { await logoutCurrentSession(); onBack(); }} className="p-3 rounded-full bg-white"><LogOut className="w-5 h-5" /></button>
        </header>
        <div className="space-y-4">
          {points.map((point) => (
            <article key={point.id} className="bg-white rounded-3xl p-5 shadow-sm">
              <div className="flex justify-between gap-3"><div><span className="text-xs font-bold uppercase text-[#b26838]">{point.point_type === "quarry" ? "Карьер" : "Накопитель"}</span><h2 className="text-xl font-bold">{point.name}</h2></div><span className="text-xs rounded-full bg-stone-100 px-3 py-2 h-fit">{STATUS_LABELS[point.moderation_status]}</span></div>
              <p className="text-sm text-stone-500 mt-2">{point.address}</p>
              {point.moderation_comment && <p className="mt-3 p-3 rounded-xl bg-rose-50 text-rose-700 text-sm">{point.moderation_comment}</p>}
              <div className="flex gap-2 mt-4">
                <label className="flex-1 rounded-full border border-stone-200 py-3 text-center font-semibold cursor-pointer"><Upload className="inline w-4 h-4 mr-2" />Фото<input type="file" accept="image/*" className="hidden" onChange={(event) => event.target.files?.[0] && void uploadPhoto(point.id, event.target.files[0])} /></label>
                <button disabled={isBusy || point.moderation_status === "pending_moderation"} onClick={() => void submitPoint(point.id)} className="flex-1 rounded-full bg-[#163f35] text-white font-bold disabled:opacity-40">На модерацию</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f1e8] sm:max-w-md sm:mx-auto p-5">
      <button onClick={onBack} className="p-3 rounded-full bg-white mb-5"><ArrowLeft className="w-5 h-5" /></button>
      <h1 className="text-3xl font-bold text-[#163f35]">Стать поставщиком</h1>
      <p className="text-stone-600 mt-2 mb-6">Зарегистрируйте карьер или накопитель и отправьте карточку на проверку.</p>
      {otpPhone ? (
        <form onSubmit={verify} className="bg-white rounded-3xl p-5 space-y-4">
          <label className="block text-sm font-semibold">Код из СМС<input value={otpCode} onChange={(event) => setOtpCode(event.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label>
          <button disabled={isBusy} className="w-full rounded-full bg-[#163f35] text-white py-4 font-bold">{isBusy ? <Loader2 className="animate-spin mx-auto" /> : "Подтвердить"}</button>
        </form>
      ) : (
        <form onSubmit={register} className="bg-white rounded-3xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3"><input required placeholder="Телефон" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-xl border p-3" /><input required type="password" minLength={6} placeholder="Пароль" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-xl border p-3" /></div>
          <input required placeholder="Название точки" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-xl border p-3" />
          <select value={form.point_type} onChange={(e) => setForm({ ...form, point_type: e.target.value })} className="w-full rounded-xl border p-3"><option value="quarry">Карьер, доставка от 5 000 ₽</option><option value="accumulator">Накопитель, доставка от 3 000 ₽</option></select>
          <input required placeholder="Адрес" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-xl border p-3" />
          <div className="grid grid-cols-2 gap-3"><input required type="number" step="any" value={form.lat} onChange={(e) => setForm({ ...form, lat: Number(e.target.value) })} className="rounded-xl border p-3" /><input required type="number" step="any" value={form.lon} onChange={(e) => setForm({ ...form, lon: Number(e.target.value) })} className="rounded-xl border p-3" /></div>
          <div className="grid grid-cols-2 gap-3"><select required value={form.material_id} onChange={(e) => setForm({ ...form, material_id: e.target.value })} className="rounded-xl border p-3"><option value="">Материал</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}</select><input required type="number" min="0.01" step="0.01" placeholder="Цена" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="rounded-xl border p-3" /></div>
          <button disabled={isBusy} className="w-full rounded-full bg-[#163f35] text-white py-4 font-bold">{isBusy ? <Loader2 className="animate-spin mx-auto" /> : "Получить код"}</button>
        </form>
      )}
    </div>
  );
}
