export default function LegalConsentText() {
  return (
    <p className="mt-4 text-center text-xs leading-relaxed text-gray-500">
      Продолжая, вы соглашаетесь с{" "}
      <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#218fbf] underline underline-offset-2">
        Политикой конфиденциальности
      </a>{" "}
      и{" "}
      <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-[#218fbf] underline underline-offset-2">
        Пользовательским соглашением
      </a>
      .
    </p>
  );
}
