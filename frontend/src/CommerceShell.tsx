import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function CommerceShell({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return createPortal(<section className="fixed inset-0 z-[100000] overflow-y-auto bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 px-4 pb-4 pt-[max(env(safe-area-inset-top),2.5rem)] backdrop-blur">
      <div className={`mx-auto flex items-center gap-3 ${wide ? 'max-w-6xl' : 'max-w-md'}`}>
        <button aria-label="Назад" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 hover:bg-slate-200"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0"><h1 className="text-xl font-extrabold tracking-tight">{title}</h1><p className="mt-0.5 text-xs text-slate-500">{subtitle}</p></div>
      </div>
    </header>
    <main className={`mx-auto space-y-4 px-4 pt-5 pb-[max(env(safe-area-inset-bottom),2rem)] ${wide ? 'max-w-6xl' : 'max-w-md'}`}>{children}</main>
  </section>, document.body);
}
