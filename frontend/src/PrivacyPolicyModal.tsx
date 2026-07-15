interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PrivacyPolicyModal({ isOpen, onClose }: PrivacyPolicyModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-policy-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 text-left shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="privacy-policy-title" className="text-xl font-black text-slate-900">
            Политика конфиденциальности
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xl text-slate-500 transition-colors hover:bg-slate-200"
          >
            ×
          </button>
        </div>

        <p className="mt-6 text-sm leading-relaxed text-slate-600">
          Документ находится в стадии разработки и скоро будет опубликован.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-2xl bg-[#2DB0E6] py-3.5 font-bold text-white transition-colors hover:bg-[#209ccf]"
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}
