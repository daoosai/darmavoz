import React, { useState, useEffect } from "react";
import { Plus, Edit2, Map, Mountain } from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "./store";
import { baseURL } from "./utils";

export interface Quarry {
  id?: number;
  name: string;
  address: string;
  lat: number;
  lon: number;
  is_active: boolean;
  material_ids?: number[];
  materials?: any[];
}

interface AdminQuarriesScreenProps {
  materials: any[];
}

export default function AdminQuarriesScreen({
  materials,
}: AdminQuarriesScreenProps) {
  const { token } = useAuthStore();
  const [quarries, setQuarries] = useState<Quarry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuarry, setEditingQuarry] = useState<Quarry | null>(null);

  const fetchQuarries = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${baseURL}/admin/quarries`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setQuarries(data);
      }
    } catch (e) {
      console.error("Error fetching quarries", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQuarries();
  }, []);

  const handleOpenModal = (quarry?: Quarry) => {
    if (quarry) {
      setEditingQuarry(quarry);
    } else {
      setEditingQuarry({
        name: "",
        address: "",
        lat: 0,
        lon: 0,
        is_active: true,
        material_ids: [],
      });
    }
    setIsModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[#2DB0E6] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Карьеры</h2>
            <p className="text-sm text-slate-500">
              Управление точками погрузки
            </p>
          </div>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-[#2DB0E6] text-white px-4 py-2 rounded-xl font-bold hover:bg-[#209BD6] transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Добавить
        </button>
      </div>

      {/* Desktop View */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden hidden md:block">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider font-bold">
                <th className="p-4 border-b border-slate-100">ID</th>
                <th className="p-4 border-b border-slate-100">Название</th>
                <th className="p-4 border-b border-slate-100">Адрес</th>
                <th className="p-4 border-b border-slate-100">Статус</th>
                <th className="p-4 border-b border-slate-100">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {quarries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    Нет карьеров
                  </td>
                </tr>
              ) : (
                quarries.map((quarry) => (
                  <tr
                    key={quarry.id}
                    className="hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="p-4 text-sm font-medium text-slate-600">
                      #{quarry.id}
                    </td>
                    <td className="p-4 font-bold text-slate-800">
                      {quarry.name}
                    </td>
                    <td className="p-4 text-sm text-slate-600 max-w-[250px] truncate">
                      {quarry.address}
                    </td>
                    <td className="p-4">
                      {quarry.is_active ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold">
                          Активен
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">
                          Скрыт
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => handleOpenModal(quarry)}
                        className="p-2 text-slate-400 hover:text-[#2DB0E6] hover:bg-[#2DB0E6]/10 rounded-xl transition-all"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile View */}
      <div className="flex flex-col gap-4 md:hidden">
        {quarries.length === 0 ? (
          <div className="p-8 text-center text-slate-500 bg-white rounded-2xl border border-slate-100 shadow-sm">
            Нет карьеров
          </div>
        ) : (
          quarries.map((quarry) => (
            <div
              key={quarry.id}
              className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm flex flex-col gap-3"
            >
              <div className="flex justify-between items-start gap-2">
                <h3 className="font-semibold text-gray-900 text-lg">
                  {quarry.name}
                </h3>
                <span className="text-xs text-gray-400 shrink-0 font-mono">
                  ID: {quarry.id.slice(0, 8)}...
                </span>
              </div>
              <div className="text-sm text-gray-600">
                {quarry.address || `${quarry.lat}, ${quarry.lon}`}
              </div>
              <div className="flex items-center justify-between mt-1">
                <div>
                  {quarry.is_active ? (
                    <span className="inline-flex items-center px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold">
                      Активен
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">
                      Скрыт
                    </span>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => handleOpenModal(quarry)}
                    className="p-2 text-slate-400 hover:text-[#2DB0E6] hover:bg-[#2DB0E6]/10 rounded-xl transition-all"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {isModalOpen && editingQuarry && (
        <EditQuarryModal
          quarry={editingQuarry}
          materials={materials}
          onClose={() => setIsModalOpen(false)}
          onSave={() => {
            setIsModalOpen(false);
            fetchQuarries();
          }}
        />
      )}
    </div>
  );
}

function EditQuarryModal({
  quarry,
  materials,
  onClose,
  onSave,
}: {
  quarry: Quarry;
  materials: any[];
  onClose: () => void;
  onSave: () => void;
}) {
  const { token } = useAuthStore();
  const [formData, setFormData] = useState<Quarry>(quarry);
  const [isSaving, setIsSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);

  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any>(null);

  React.useEffect(() => {
    let mapInstance: any = null;

    if ((window as any).mapgl && !mapRef.current) {
      const container = document.getElementById("quarry-map");
      if (container) {
        const initialLon = formData.lon || 65.527202;
        const initialLat = formData.lat || 57.152223;

        mapInstance = new (window as any).mapgl.Map("quarry-map", {
          center: [initialLon, initialLat],
          zoom: 12,
          key: "1ee6f536-8494-4bb2-adc0-d011444c567a",
        });

        mapRef.current = mapInstance;

        if (formData.lat && formData.lon) {
          markerRef.current = new (window as any).mapgl.Marker(mapInstance, {
            coordinates: [formData.lon, formData.lat],
          });
        }
      }
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
      if (markerRef.current) {
        markerRef.current.destroy();
        markerRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (mapRef.current && formData.lat && formData.lon) {
      const coords: [number, number] = [formData.lon, formData.lat];

      mapRef.current.setCenter(coords);

      if (markerRef.current) {
        markerRef.current.setCoordinates(coords);
      } else {
        markerRef.current = new (window as any).mapgl.Marker(mapRef.current, {
          coordinates: coords,
        });
      }
    }
  }, [formData.lat, formData.lon]);

  const handleLatChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const coordsArray = value.split(/[,\s]+/);
    if (coordsArray.length >= 2) {
      const parsedLat = parseFloat(coordsArray[0]);
      const parsedLon = parseFloat(coordsArray[1]);
      if (!isNaN(parsedLat) && !isNaN(parsedLon)) {
        setFormData((prev) => ({ ...prev, lat: parsedLat, lon: parsedLon }));
        return;
      }
    }
    setFormData((prev) => ({ ...prev, lat: parseFloat(value) || 0 }));
  };

  const fetch2GISSuggests = async (query: string) => {
    if (query.length < 3) return [];
    try {
      const res = await fetch(
        `https://catalog.api.2gis.com/3.0/suggests?q=${encodeURIComponent(query)}&suggest_type=address&key=1ee6f536-8494-4bb2-adc0-d011444c567a`,
      );
      const data = await res.json();
      return data.result?.items || [];
    } catch (e) {
      return [];
    }
  };

  const getCoordsFromBackend = async (address: string) => {
    try {
      const res = await fetch(
        `${baseURL}/geo/geocode?address=${encodeURIComponent(address)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (res.ok) {
        const data = await res.json();
        return { lat: data.lat, lon: data.lon };
      }
    } catch (e) {}
    return null;
  };

  const handleAddressChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const val = e.target.value;
    setFormData((prev) => ({ ...prev, address: val }));
    const suggests = await fetch2GISSuggests(val);
    setSuggestions(
      suggests
        .map((s: any) => s.search_attributes?.suggested_text || s.name)
        .filter(Boolean),
    );
  };

  const selectSuggestion = async (address: string) => {
    setFormData((prev) => ({ ...prev, address }));
    setSuggestions([]);

    // Auto geocode
    const coords = await getCoordsFromBackend(address);
    if (coords) {
      setFormData((prev) => ({ ...prev, lat: coords.lat, lon: coords.lon }));
    }
  };

  const toggleMaterial = (id: number) => {
    setFormData((prev) => {
      const ids = prev.material_ids || [];
      if (ids.includes(id)) {
        return { ...prev, material_ids: ids.filter((m) => m !== id) };
      } else {
        return { ...prev, material_ids: [...ids, id] };
      }
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    const nameTrimmed = formData.name?.trim() || "";
    const addressTrimmed = formData.address?.trim() || "";
    const hasCoords =
      formData.lat !== null &&
      formData.lon !== null &&
      !isNaN(formData.lat) &&
      !isNaN(formData.lon);

    if (!nameTrimmed) {
      toast.error("Пожалуйста, введите название карьера");
      return;
    }

    if (!addressTrimmed && !hasCoords) {
      toast.error(
        "Необходимо указать адрес или заполнить координаты (Широту и Долготу)",
      );
      return;
    }

    const finalAddress =
      addressTrimmed || `По координатам: ${formData.lat}, ${formData.lon}`;

    try {
      setIsSaving(true);
      const url = formData.id
        ? `${baseURL}/admin/quarries/${formData.id}`
        : `${baseURL}/admin/quarries`;

      const payload = {
        ...formData,
        name: nameTrimmed,
        address: finalAddress,
      };

      const res = await fetch(url, {
        method: formData.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Failed to save");
      toast.success("Карьер сохранен");
      onSave();
    } catch (e) {
      toast.error("Ошибка при сохранении");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-xl font-bold text-slate-800">
            {formData.id ? "Редактировать карьер" : "Добавить карьер"}
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 rounded-full transition-colors"
          >
            <span className="text-xl leading-none">&times;</span>
          </button>
        </div>

        <form
          onSubmit={handleSave}
          className="p-6 overflow-y-auto flex flex-col gap-5"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Название
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
            />
          </div>

          <div className="flex flex-col gap-1.5 relative">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Адрес
            </label>
            <input
              type="text"
              value={formData.address}
              onChange={handleAddressChange}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-[9999] top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
                {suggestions.map((addr, idx) => (
                  <li
                    key={idx}
                    onClick={() => selectSuggestion(addr)}
                    className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-gray-100 last:border-0 text-sm"
                  >
                    {addr}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Контейнер для карты 2ГИС */}
          <div
            id="quarry-map"
            className="w-full h-48 min-h-[192px] bg-gray-200 rounded-xl my-4 overflow-hidden"
          ></div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Широта (Lat)
              </label>
              <input
                type="text"
                value={formData.lat || ""}
                onChange={handleLatChange}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Долгота (Lon)
              </label>
              <input
                type="text"
                value={formData.lon || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    lon: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#2DB0E6]/20 focus:border-[#2DB0E6] transition-all font-medium"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Материалы карьера
            </label>
            <div className="max-h-40 overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
              {materials.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-3 p-1 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={(formData.material_ids || []).includes(m.id)}
                    onChange={() => toggleMaterial(m.id)}
                    className="w-5 h-5 rounded border-slate-300 text-[#2DB0E6] focus:ring-[#2DB0E6]"
                  />
                  <span className="text-sm font-medium text-slate-700">
                    {m.name}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={formData.is_active}
                onChange={(e) =>
                  setFormData({ ...formData, is_active: e.target.checked })
                }
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              <span className="ml-3 text-sm font-medium text-slate-700">
                Активен
              </span>
            </label>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-3.5 bg-[#2DB0E6] hover:bg-[#209BD6] text-white rounded-xl font-bold transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2"
            >
              {isSaving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
