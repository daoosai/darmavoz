import { ArrowLeft } from "lucide-react";

interface PrivacyPolicyScreenProps {
  onBack: () => void;
}

export default function PrivacyPolicyScreen({ onBack }: PrivacyPolicyScreenProps) {
  return (
    <main className="min-h-screen bg-white pt-[max(env(safe-area-inset-top),2.5rem)] text-slate-900">
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <header className="mb-8 flex items-center gap-3 border-b border-slate-200 pb-4">
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-slate-700 transition-colors hover:bg-slate-100"
            aria-label="Назад на главную страницу"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="font-semibold">Назад</span>
          </button>
        </header>

        <article className="text-base leading-7 text-slate-700">
          <h1 className="mb-6 text-3xl font-bold leading-tight text-slate-900">
            Политика конфиденциальности приложения «Дармавоз»
          </h1>

          <p className="mb-4">
            Настоящая Политика конфиденциальности описывает, как ООО «ДАРМАВОЗ» собирает,
            использует и защищает вашу информацию при использовании нашего приложения и сайта.
          </p>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">1. Сбор данных</h2>
            <p className="mb-4">Мы собираем следующие данные:</p>

            <p className="mb-4">
              <strong className="font-semibold text-slate-900">Личная информация:</strong> Имя,
              номер телефона и адрес электронной почты (для регистрации и связи по заказам).
            </p>

            <p className="mb-4">
              <strong className="font-semibold text-slate-900">
                Данные о местоположении (Геолокация):
              </strong>{" "}
              Приложение собирает данные о вашем точном местоположении.
            </p>

            <ul className="mb-4 list-disc space-y-2 pl-6">
              <li>
                <strong className="font-semibold text-slate-900">Для Клиентов:</strong> используется
                только при активном приложении для точного определения адреса доставки на карте.
              </li>
              <li>
                <strong className="font-semibold text-slate-900">Для Водителей:</strong> приложение
                собирает данные о местоположении в фоновом режиме (даже когда приложение закрыто
                или не используется), если водитель включил статус «На смене». Это необходимо для
                расчета логистического плеча, диспетчеризации и отображения машины на карте логиста.
              </li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">2. Использование данных</h2>
            <p className="mb-4">Ваши данные используются исключительно для:</p>
            <ul className="mb-4 list-disc space-y-2 pl-6">
              <li>Оформления и исполнения заказов на сыпучие материалы и спецтехнику.</li>
              <li>Связи логистов и клиентов с водителями.</li>
              <li>Улучшения работы сервиса и безопасности.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">3. Защита и передача данных</h2>
            <p className="mb-4">
              Мы используем современные методы шифрования (HTTPS) для защиты ваших данных. Мы не
              передаем ваши личные данные третьим лицам, за исключением случаев, когда это
              необходимо для выполнения заказа (например, передача номера телефона клиента
              водителю) или требуется по закону.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">
              4. Удаление аккаунта и данных
            </h2>
            <p className="mb-4">
              Вы имеете право в любой момент удалить свой аккаунт и связанные с ним личные данные.
              Это можно сделать прямо в приложении: перейдите в раздел «Профиль» и нажмите кнопку
              «Удалить аккаунт». Данные будут безвозвратно удалены из нашей системы.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">5. Контакты</h2>
            <p className="mb-4">
              Если у вас возникли вопросы по поводу конфиденциальности, вы можете связаться со
              службой поддержки по телефону: 8 (3452) 900 900.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
