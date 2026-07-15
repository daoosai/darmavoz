import { Edit2, Plus, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage } from "./utils";

export interface AdminCategoryItem {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}

interface Props {
  token: string;
  categories: AdminCategoryItem[];
  onChanged: () => Promise<void> | void;
}

export default function AdminCategoriesPanel({ token, categories, onChanged }: Props) {
  const [editing, setEditing] = useState<AdminCategoryItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setIsActive(true);
    setIsCreating(true);
  };

  const openEdit = (category: AdminCategoryItem) => {
    setEditing(category);
    setName(category.name);
    setIsActive(category.is_active);
    setIsCreating(true);
  };

  const closeForm = () => {
    setEditing(null);
    setIsCreating(false);
  };

  const saveCategory = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) return;

    setIsSaving(true);
    try {
      const response = await fetch(
        editing
          ? `${baseURL}/admin/categories/${editing.id}`
          : `${baseURL}/admin/categories/`,
        {
          method: editing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name: normalizedName, is_active: isActive }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось сохранить категорию"));
      }
      await onChanged();
      closeForm();
      toast.success(editing ? "Категория обновлена" : "Категория создана");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить категорию");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteCategory = async (category: AdminCategoryItem) => {
    if (!window.confirm(`Удалить категорию «${category.name}»?`)) return;
    setIsSaving(true);
    try {
      const response = await fetch(`${baseURL}/admin/categories/${category.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось удалить категорию"));
      }
      await onChanged();
      toast.success(data.action === "hidden" ? "Категория скрыта: в ней есть материалы" : "Категория удалена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить категорию");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Категории доставки</h2>
          <p className="mt-1 text-sm text-slate-500">Направления, по которым группируются материалы.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white hover:bg-sky-600"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Добавить категорию</span>
        </button>
      </div>

      {isCreating ? (
        <form onSubmit={saveCategory} className="mt-4 grid gap-3 rounded-xl border border-sky-100 bg-sky-50/50 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <input
            required
            maxLength={255}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Название категории"
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-500"
          />
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="h-5 w-5 rounded border-slate-300 text-sky-500" />
            Активна
          </label>
          <div className="flex gap-2">
            <button disabled={isSaving} type="submit" className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
              {editing ? "Сохранить" : "Создать"}
            </button>
            <button type="button" onClick={closeForm} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-500 hover:bg-slate-100" aria-label="Закрыть">
              <X className="h-4 w-4" />
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <article key={category.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <div className="min-w-0">
              <div className="truncate font-bold text-slate-800">{category.name}</div>
              <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${category.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {category.is_active ? "Активна" : "Скрыта"}
              </span>
            </div>
            <div className="flex shrink-0 gap-1">
              <button type="button" onClick={() => openEdit(category)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-sky-50 hover:text-sky-600" aria-label="Редактировать категорию">
                <Edit2 className="h-4 w-4" />
              </button>
              <button disabled={isSaving} type="button" onClick={() => void deleteCategory(category)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" aria-label="Удалить категорию">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
