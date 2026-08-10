import { useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import { baseURL, extractApiErrorMessage } from "../../utils";

interface DeleteAccountButtonProps {
  token: string | null;
  onDeleted: () => void | Promise<void>;
}

export default function DeleteAccountButton({
  token,
  onDeleted,
}: DeleteAccountButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    if (!token) {
      setError("Не удалось подтвердить вашу сессию. Войдите в аккаунт снова.");
      return;
    }

    setIsDeleting(true);
    setError("");
    try {
      const response = await fetch(`${baseURL}/account/me`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirm: true }),
      });
      const data = response.status === 204 ? {} : await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(extractApiErrorMessage(data, "Не удалось удалить аккаунт"));
      }

      toast.success("Аккаунт удалён");
      await onDeleted();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось удалить аккаунт",
      );
      setIsDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setIsOpen(true);
        }}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white py-3.5 font-bold text-rose-600 transition-colors hover:bg-rose-50"
      >
        <Trash2 className="h-5 w-5" />
        Удалить аккаунт
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-slate-900/50 backdrop-blur-sm"
            onClick={() => !isDeleting && setIsOpen(false)}
            aria-label="Закрыть окно удаления аккаунта"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            className="relative w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl"
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 id="delete-account-title" className="text-center text-xl font-black text-slate-900">
              Удалить аккаунт?
            </h2>
            <p className="mt-3 text-center text-sm leading-6 text-slate-600">
              Вы уверены? Это действие необратимо. Ваши активные объявления будут скрыты.
            </p>
            {error ? (
              <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                {error}
              </p>
            ) : null}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setIsOpen(false)}
                className="rounded-xl bg-slate-100 px-3 py-3 font-bold text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleDelete()}
                className="flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 py-3 font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
              >
                {isDeleting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                Удалить безвозвратно
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
