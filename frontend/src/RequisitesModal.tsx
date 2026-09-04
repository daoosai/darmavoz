import { X } from "lucide-react";

interface RequisitesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function RequisitesModal({ isOpen, onClose }: RequisitesModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-slate-950/45 p-4 sm:items-center"
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
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 text-sm leading-relaxed text-slate-700">
          <div className="mb-4">
            <p className="font-bold text-slate-900">ООО «ДАРМАВОЗ»</p>
          </div>

          <div className="mb-4">
            <p>ИНН: 7203609778</p>
            <p>КПП: 720301001</p>
            <p>ОГРН: 1267200009284</p>
          </div>

          <div className="mb-4">
            <p>Юридический адрес:</p>
            <p>Тюменская область,  г.Тюмень,</p>
            <p>ул. Федюнинского , д. 19, кв. 42</p>
          </div>

          <div>
            <p>Электронная почта: darmavozrf@gmail.com</p>
            <p>Телефон: +7 (3452) 900 900</p>
          </div>
        </div>
      </div>
    </div>
  );
}
