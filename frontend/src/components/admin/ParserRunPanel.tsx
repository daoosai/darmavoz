import { useState, type FormEvent } from "react";
import { Loader2, Play } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage } from "../../utils";

type ParserTarget = "material" | "water";

const keywords: Record<ParserTarget, string[]> = {
  material: ["карьер", "накопитель", "песок", "щебень", "пгс", "песчано-гравийная смесь"],
  water: ["вода", "питьевая вода", "техническая вода"],
};

export default function ParserRunPanel({ target, token, onCompleted }: { target: ParserTarget; token: string | null; onCompleted?: () => void | Promise<void> }) {
  const [city, setCity] = useState("Тюмень");
  const [lat, setLat] = useState("57.1522");
  const [lon, setLon] = useState("65.5272");
  const [radius, setRadius] = useState("10000");
  const [keyword, setKeyword] = useState(keywords[target][0]);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(`${baseURL}/admin/parser/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ city, center_lat: Number(lat), center_lon: Number(lon), radius_m: Number(radius), target, keyword }),
      });
      if (!response.ok) throw new Error(await extractApiErrorMessage(response, "Не удалось запустить импорт"));
      const result = await response.json() as { created: number; updated: number; skipped: number; cross_target_conflicts: number; truncated: boolean };
      toast.success(`Импорт: создано ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped + result.cross_target_conflicts}${result.truncated ? ". Достигнут лимит" : ""}`);
      await onCompleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось запустить импорт");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4 lg:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))_auto]">
      <label className="text-xs font-bold text-slate-600">Город<input required value={city} onChange={(event) => setCity(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
      <label className="text-xs font-bold text-slate-600">Широта<input required type="number" step="any" value={lat} onChange={(event) => setLat(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
      <label className="text-xs font-bold text-slate-600">Долгота<input required type="number" step="any" value={lon} onChange={(event) => setLon(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
      <label className="text-xs font-bold text-slate-600">Радиус, м<input required type="number" min="100" max="50000" value={radius} onChange={(event) => setRadius(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
      <label className="text-xs font-bold text-slate-600">Ключевое слово<select value={keyword} onChange={(event) => setKeyword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">{keywords[target].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <button type="submit" disabled={loading || !token} className="flex items-center justify-center gap-2 self-end rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Запустить</button>
    </form>
  );
}
