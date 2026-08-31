export default function WelcomeScreen({
  onSelectClient,
  onSelectEmployee,
}: {
  onSelectClient: () => void;
  onSelectEmployee: () => void;
}) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center overflow-y-auto bg-slate-50 px-6 text-center">
      <div className="flex w-full flex-1 flex-col items-center justify-center py-8">
        <h1 className="mb-16 text-4xl font-black tracking-tight text-[#2DB0E6]">
          Дармавоз
        </h1>

        <div className="flex w-full max-w-xs flex-col gap-4">
          <button
            onClick={onSelectClient}
            className="w-full rounded-2xl border border-slate-200 bg-white py-4 text-lg font-bold text-[#2DB0E6] shadow-sm transition-colors active:bg-slate-50"
          >
            Я Клиент
          </button>

          <button
            onClick={onSelectEmployee}
            className="w-full rounded-2xl border border-slate-200 bg-white py-4 text-lg font-bold text-[#2DB0E6] shadow-sm transition-colors active:bg-blue-50"
          >
            Вход для партнеров
          </button>
        </div>
      </div>

      <footer className="mt-4 flex flex-col items-center gap-3 pb-[max(env(safe-area-inset-bottom),1.5rem)] text-gray-400">
        <p className="text-base text-gray-500">
          Служба поддержки{" "}
          <a href="tel:+73452900900" className="font-bold text-gray-700">
            8 (3452) 900 900
          </a>
        </p>
        <a
          href="/privacy"
          className="mt-2 text-xs text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline"
        >
          Политика конфиденциальности
        </a>
      </footer>
    </div>
  );
}
