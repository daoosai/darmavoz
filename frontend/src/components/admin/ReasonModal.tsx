import type { FormEvent } from "react";
import { X } from "lucide-react";

interface ReasonModalProps {
  isOpen: boolean;
  eyebrow?: string;
  title: string;
  subject?: string;
  label?: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  submitLabel?: string;
  submittingLabel?: string;
  isSubmitting?: boolean;
  submitDisabled?: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export default function ReasonModal({
  isOpen,
  eyebrow,
  title,
  subject,
  label = "Причина",
  value,
  placeholder,
  maxLength = 5000,
  submitLabel = "Сохранить",
  submittingLabel = "Сохраняем...",
  isSubmitting = false,
  submitDisabled = false,
  onChange,
  onClose,
  onSubmit,
}: ReasonModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            {eyebrow ? (
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-rose-600">
                {eyebrow}
              </p>
            ) : null}
            <h3 className="text-xl font-black text-slate-900">{title}</h3>
            {subject ? (
              <p className="mt-1 text-sm font-medium text-slate-500">{subject}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="block text-sm font-bold text-slate-900">
          {label}
          <textarea
            autoFocus
            required
            rows={5}
            maxLength={maxLength}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className="mt-2 w-full resize-none rounded-xl bg-slate-100 p-3 font-normal outline-none ring-0 transition focus:bg-white focus:ring-2 focus:ring-rose-200"
          />
        </label>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-slate-100 p-3 font-bold text-slate-600 transition hover:bg-slate-200"
          >
            Отмена
          </button>
          <button
            disabled={isSubmitting || submitDisabled}
            className="flex-1 rounded-xl bg-rose-600 p-3 font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {isSubmitting ? submittingLabel : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
