import { ArrowLeft } from "lucide-react";

interface TermsPageProps {
  onBack: () => void;
}

export default function TermsPage({ onBack }: TermsPageProps) {
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
          <h1 className="mb-6 text-3xl font-bold leading-tight text-slate-900">Пользовательское соглашение</h1>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">1. Общие положения</h2>
            <p className="mb-4">1.1. Настоящее Пользовательское соглашение (далее — Соглашение) регулирует отношения между ООО «ДАРМАВОЗ» (ИНН 7203609778, ОГРН 1267200009284) (далее — Администрация) и любым лицом, использующим Платформу «Дармавоз» (далее — Пользователь).</p>
            <p className="mb-4">1.2. Использование Платформы означает безоговорочное согласие Пользователя с настоящим Соглашением.</p>
          </section>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">2. Предмет соглашения</h2>
            <p className="mb-4">2.1. Платформа предоставляет информационный сервис (маркетплейс), позволяющий Пользователям размещать информацию о продаже сыпучих нерудных материалов, услугах спецтехники, доставке воды и откачке септиков, а другим Пользователям — находить эти предложения и оформлять заказы.</p>
            <p className="mb-4">2.2. Администрация является информационным посредником (агрегатором) и может не выступать продавцом товаров или непосредственным исполнителем услуг по перевозке, если иное не указано в заказе.</p>
          </section>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">3. Регистрация и авторизация</h2>
            <p className="mb-4">3.1. Для полного доступа к функционалу Платформы требуется авторизация по номеру телефона (через СМС-код).</p>
            <p className="mb-4">3.2. Пользователь несет ответственность за сохранность своих данных авторизации и за все действия, совершенные под его учетной записью.</p>
          </section>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">4. Права и обязанности сторон</h2>
            <p className="mb-4">4.1. Пользователь обязуется предоставлять достоверную информацию при оформлении заказа и регистрации.</p>
            <p className="mb-4">4.2. Администрация Платформы оставляет за собой право заблокировать аккаунт Пользователя в случае нарушения им правил сервиса или выявления мошеннических действий.</p>
          </section>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">5. Оформление заказов и расчет стоимости</h2>
            <p className="mb-4">5.1. Стоимость материалов и доставки рассчитывается Платформой автоматически на основе предоставленных Поставщиками прайс-листов и алгоритмов маршрутизации.</p>
            <p className="mb-4">5.2. Окончательная стоимость и условия доставки подтверждаются логистом или исполнителем после оформления заявки.</p>
          </section>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">6. Ограничение ответственности</h2>
            <p className="mb-4">6.1. Администрация не несет ответственности за перебои в работе Платформы, вызванные техническими неполадками на стороне интернет-провайдеров или сервисов геолокации.</p>
            <p className="mb-4">6.2. Все споры между Пользователем-заказчиком и Пользователем-исполнителем (водителем, поставщиком) решаются сторонами самостоятельно, при информационном содействии Администрации Платформы.</p>
          </section>

          <section className="mb-8">
            <h2 className="mb-4 text-2xl font-bold text-slate-900">7. Изменение условий</h2>
            <p className="mb-4">7.1. Администрация вправе в любой момент вносить изменения в настоящее Соглашение. Новая редакция вступает в силу с момента ее публикации на Платформе.</p>
          </section>
        </article>
      </div>
    </main>
  );
}
