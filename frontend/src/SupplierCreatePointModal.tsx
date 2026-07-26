import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImagePlus, Loader2, MapPin, Search, X } from "lucide-react";
import toast from "react-hot-toast";

import { fetch2gisAddressSuggestions } from "./addressSearch";
import { baseURL, extractApiErrorMessage } from "./utils";

type EditablePointType = "quarry" | "accumulator";

export interface SupplierPoint {
  id: string;
  point_type: "quarry" | "accumulator" | "warehouse" | "supplier";
  name: string;
  short_name?: string | null;
  address: string;
  description?: string | null;
  lat: number | null;
  lon: number | null;
  moderation_status: string;
  moderation_comment?: string | null;
  primary_image_url?: string | null;
  media_files?: Array<{
    id: string;
    public_url: string;
    is_primary?: boolean;
  }>;
  material_offers?: Array<{
    material_id: string;
    price: number;
    is_active: boolean;
  }>;
}

interface Props {
  token: string;
  point?: SupplierPoint | null;
  onClose: () => void;
  onSaved: (point: SupplierPoint) => void;
}

const normalizeEditablePointType = (value?: SupplierPoint["point_type"]): EditablePointType =>
  value === "accumulator" ? "accumulator" : "quarry";

const normalizeOptionalText = (value: string) => {
  const normalized = value.trim();
  return normalized || null;
};

const initialForm = {
  point_type: "quarry" as EditablePointType,
  name: "",
  address: "",
  description: "",
};

const buildSupplierPointPayload = (form: typeof initialForm) => ({
  point_type: form.point_type,
  name: form.name.trim(),
  short_name: form.name.trim(),
  address: form.address.trim(),
  description: normalizeOptionalText(form.description),
  material_offers: [],
});

const suggestionLabel = (item: any): string =>
  item.full_name || item.address_name || item.name || item.search_attributes?.suggested_text || "";

export default function SupplierCreatePointModal({ token, point, onClose, onSaved }: Props) {
  const isEditing = Boolean(point);
  const [form, setForm] = useState(() =>
    point
      ? {
          point_type: normalizeEditablePointType(point.point_type),
          name: point.name,
          address: point.address || "",
          description: point.description || "",
        }
      : initialForm,
  );
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingFilePreviews, setPendingFilePreviews] = useState<string[]>([]);
  const addressContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const query = form.address.trim();
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }
    const timeoutId = window.setTimeout(async () => {
      setSuggestions(await fetch2gisAddressSuggestions(query));
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [form.address]);

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!addressContainerRef.current?.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, []);

  useEffect(() => {
    const nextPreviews = pendingFiles.map((file) => URL.createObjectURL(file));
    setPendingFilePreviews(nextPreviews);
    return () => {
      nextPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [pendingFiles]);

  const uploadMediaFiles = async (
    pointId: string,
    files: File[],
    initialMedia: NonNullable<SupplierPoint["media_files"]> = [],
  ) => {
    let nextMedia = [...initialMedia];
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    for (const file of files) {
      const isPrimary = nextMedia.length === 0;
      const presignResponse = await fetch(`${baseURL}/media/presign-upload`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          entity_type: "quarry",
          entity_id: pointId,
          is_primary: isPrimary,
        }),
      });
      const presign = await presignResponse.json().catch(() => ({}));
      if (!presignResponse.ok) {
        throw new Error(extractApiErrorMessage(presign, "Не удалось подготовить загрузку фотографии"));
      }

      const uploadResponse = await fetch(presign.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("Не удалось загрузить фотографию");
      }

      const confirmResponse = await fetch(`${baseURL}/media/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          entity_type: "quarry",
          entity_id: pointId,
          object_key: presign.object_key,
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          is_primary: isPrimary,
        }),
      });
      const confirmed = await confirmResponse.json().catch(() => ({}));
      if (!confirmResponse.ok || !confirmed.media_file) {
        throw new Error("Не удалось подтвердить фотографию");
      }

      nextMedia = [...nextMedia, confirmed.media_file];
    }

    return nextMedia;
  };

  const selectSuggestion = (item: any) => {
    setForm((current) => ({
      ...current,
      address: suggestionLabel(item),
    }));
    setShowSuggestions(false);
  };

  const handleSelectFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setPendingFiles((current) => [...current, ...Array.from(files)]);
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const address = form.address.trim();

    if (!name) {
      toast.error("Укажите название точки");
      return;
    }
    if (!address) {
      toast.error("Укажите адрес точки");
      return;
    }

    setIsBusy(true);
    try {
      const payload = buildSupplierPointPayload(form);
      const response = await fetch(
        isEditing ? `${baseURL}/supplier/points/${point!.id}` : `${baseURL}/supplier/points`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          extractApiErrorMessage(
            data,
            isEditing ? "Не удалось сохранить изменения" : "Не удалось создать точку",
          ),
        );
      }

      let savedPoint = data as SupplierPoint;
      if (pendingFiles.length > 0 && savedPoint.id) {
        const uploadedMedia = await uploadMediaFiles(
          savedPoint.id,
          pendingFiles,
          savedPoint.media_files || [],
        );
        savedPoint = {
          ...savedPoint,
          media_files: uploadedMedia,
          primary_image_url:
            uploadedMedia.find((media) => media.is_primary)?.public_url ||
            uploadedMedia[0]?.public_url ||
            null,
        };
      }

      onSaved(savedPoint);
      toast.success(
        isEditing
          ? "Изменения сохранены и отправлены на повторную модерацию"
          : "Анкета точки отправлена на модерацию",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isEditing
            ? "Не удалось сохранить изменения"
            : "Не удалось создать точку",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const existingMedia = point?.media_files || [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-sm">
      <div className="min-h-screen bg-slate-50 sm:mx-auto sm:my-6 sm:min-h-0 sm:max-w-xl sm:rounded-3xl">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:rounded-t-3xl">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-500">
              {isEditing ? "Редактирование" : "Новая анкета"}
            </p>
            <h2 className="text-2xl font-black text-slate-900">
              {isEditing ? point!.name : "Добавить точку"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-slate-100 p-3 text-slate-700 hover:bg-slate-200"
            aria-label="Закрыть"
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={submit} className="space-y-5 p-5 pb-12">
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <label className="text-sm font-bold text-slate-900">Тип точки</label>
            <select
              value={form.point_type}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  point_type: event.target.value as EditablePointType,
                }))
              }
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-900 outline-none focus:border-sky-500"
            >
              <option value="quarry">Карьер</option>
              <option value="accumulator">Накопитель</option>
            </select>
          </section>

          <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
            <div>
              <label className="text-sm font-bold text-slate-900">Название</label>
              <input
                required
                placeholder="Например, Карьер Северный"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-900 outline-none focus:border-sky-500"
              />
            </div>

            <div ref={addressContainerRef} className="relative">
              <label className="text-sm font-bold text-slate-900">Адрес</label>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                <input
                  value={form.address}
                  onFocus={() => setShowSuggestions(true)}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, address: event.target.value }));
                    setShowSuggestions(true);
                  }}
                  placeholder="Укажите адрес точки"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-3 text-slate-900 outline-none focus:border-sky-500"
                />
                {showSuggestions && suggestions.length > 0 ? (
                  <div className="absolute z-30 mt-2 max-h-56 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
                    {suggestions.map((item, index) => (
                      <button
                        key={item.id || index}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectSuggestion(item);
                        }}
                        className="flex w-full items-start gap-2 rounded-xl px-3 py-3 text-left text-sm text-slate-700 hover:bg-sky-50"
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                        {suggestionLabel(item)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Координаты поставит администратор на этапе модерации.
              </p>
            </div>

            <div>
              <label className="text-sm font-bold text-slate-900">Описание</label>
              <textarea
                placeholder="Коротко опишите точку, режим работы и особенности подъезда"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                className="mt-2 min-h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-900 outline-none focus:border-sky-500"
              />
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Фотографии</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Добавьте фото точки. Основное фото выберется автоматически.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-sky-400 hover:text-sky-600">
                <ImagePlus className="h-4 w-4" />
                Добавить
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => handleSelectFiles(event.target.files)}
                />
              </label>
            </div>

            {existingMedia.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {existingMedia.map((media) => (
                  <div key={media.id} className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100">
                    <img src={media.public_url} alt="Фото точки" className="h-full w-full object-cover" />
                    {media.is_primary ? (
                      <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2 py-1 text-[10px] font-bold text-white">
                        Основное
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {pendingFiles.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {pendingFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="relative aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
                  >
                    <img
                      src={pendingFilePreviews[index]}
                      alt={file.name}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-slate-900/70 px-2 py-1 text-[10px] font-semibold text-white">
                      <span className="block truncate">{file.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePendingFile(index)}
                      className="absolute right-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[10px] font-bold text-slate-600 shadow-sm hover:text-rose-600"
                    >
                      Убрать
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {existingMedia.length === 0 && pendingFiles.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                Фото пока не добавлены
              </div>
            ) : null}
          </section>

          <button
            disabled={isBusy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 py-4 text-lg font-black text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {isEditing ? "Сохранить и отправить на модерацию" : "Отправить на модерацию"}
          </button>
        </form>
      </div>
    </div>
  );
}
