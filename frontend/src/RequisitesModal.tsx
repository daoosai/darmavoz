interface RequisitesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function RequisitesModal({ isOpen, onClose }: RequisitesModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="requisites-title"
      onClick={onClose}
    >
      <div
        className="hide-scrollbar max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 text-left shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="requisites-title" className="text-xl font-black text-slate-900">
            Реквизиты сервиса «Дармавоз»
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

        <div className="mt-6 space-y-2 text-sm leading-relaxed text-slate-700">
          <p className="font-bold text-slate-900">ООО «ДАРМАВОЗ»</p>
          <p>Домен: darmavoz.ru</p>
          <p>Электронная почта: darmavozrt@mail.ru</p>
          <p>Телефон: +7 (922) 009-00-20</p>
        </div>

        <p className="mt-6 rounded-2xl bg-sky-50 p-4 text-sm italic leading-relaxed text-slate-600">
          Сервис «Дармавоз» предназначен для оформления заказов на доставку строительных и нерудных материалов.
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
