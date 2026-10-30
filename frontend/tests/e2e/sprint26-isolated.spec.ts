/** Opt-in real API/browser tests against the disposable S26 QA backend.
 * Never point these tests at production. Auth fixture stays outside git.
 */
import { expect as baseExpect, test, type Page, type Browser } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const expect = baseExpect.configure({ timeout: 15000 });
const fixturePath = process.env.SPRINT26_QA_AUTH_FILE;
const qaApi = process.env.SPRINT26_QA_API || '';
const artifacts = path.resolve('..', 'docs/reports/sprint26/screenshots');
const viewports = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 844, height: 390 }];
interface User { token: string; role: string; driverId?: string; id: string; order_id?: string }
interface Fixture { admin: User; supplier: User; driver: User; equipment_owner: User; water_septic_partner: User; client: User; city_id: string }
function fixtures(): Fixture { return JSON.parse(readFileSync(fixturePath!, 'utf8')); }
async function login(page: Page, user: User) {
  await page.addInitScript(({ u, city }) => {
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: u.token, role: u.role, driverId: u.driverId || null }, version: 0 }));
    localStorage.setItem('selected-city', JSON.stringify({ state: { cityId: city }, version: 1 }));
  }, { u: user, city: fixtures().city_id });
  await page.route('**/api/v1/**', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
}
async function capture(page: Page, name: string, width: number) {
  await page.screenshot({ path: path.join(artifacts, `${name}-${width}.png`) });
  const overflow = await page.evaluate(() => {
    const shell = [...document.querySelectorAll('section.fixed')].at(-1) || document.body;
    return [...shell.querySelectorAll<HTMLElement>('*')].filter(el => {
      const box = el.getBoundingClientRect(); const css = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0 && css.display !== 'none' && css.visibility !== 'hidden' && (box.left < -1 || box.right > innerWidth + 1);
    }).map(el => `${el.tagName}.${el.className}`).slice(0, 8);
  });
  expect(overflow, `Horizontal overflow in ${name}`).toEqual([]);
}
async function profile(page: Page, user: User) {
  await login(page, user); await page.goto(user.role === 'admin' ? '/admin/profile' : '/');
  if (user.role !== 'admin') await page.getByRole('button', { name: 'Профиль', exact: true }).click();
}
async function api(browser: Browser, route: string, body?: unknown) {
  const context = await browser.newContext();
  const response = await context.request.fetch(qaApi + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + fixtures().admin.token }, data: body });
  expect(response.ok(), `QA API ${route}: ${response.status()}`).toBeTruthy(); const value = await response.json(); await context.close(); return value;
}
test.describe('Sprint 26 isolated backend and responsive UI', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!fixturePath || !qaApi, 'Requires explicitly provisioned isolated QA fixtures, not a production environment');
  test.beforeAll(() => { expect(qaApi).toMatch(/^http:\/\/127\.0\.0\.1:18026\/api\/v1$/); mkdirSync(artifacts, { recursive: true }); });
  test('admin subscriptions, plans, settings and journeys at all required widths', async ({ page }) => {
    test.setTimeout(180000); await profile(page, fixtures().admin);
    await page.getByText('Управление подписками', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Управление подписками' })).toBeVisible();
    await expect(page.getByText('Платежей не найдено', { exact: true })).toBeVisible();
    for (const size of viewports) {
      await page.setViewportSize(size); await capture(page, 'admin-subscription-payments', size.width);
      await page.getByRole('button', { name: 'Тарифы', exact: true }).click();
      await page.getByRole('heading', { name: 'Новый тариф', exact: true }).scrollIntoViewIfNeeded();
      await capture(page, 'admin-plan-form', size.width);
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Сохранить настройки' })).toBeAttached();
      await capture(page, 'admin-subscription-settings', size.width);
      await page.getByRole('button', { name: 'Платежи', exact: true }).click();
    }
    for (const [tab, title, label] of [
      ['Доступ и спорные случаи', 'Ручное предоставление доступа', 'admin-manual-access'],
      ['Переход', 'Подтверждённые прежние сроки', 'admin-legacy-transition'],
      ['Журнал', '', 'admin-subscription-audit'],
    ]) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      if (title) await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      for (const size of viewports) { await page.setViewportSize(size); await capture(page, label, size.width); }
    }
    await page.getByRole('button', { name: 'Назад', exact: true }).first().click();
    await page.getByText('Путь пользователя', { exact: true }).click();
    await expect(page.getByLabel('Сводка пути')).toBeVisible();
    for (const size of viewports) { await page.setViewportSize(size); await capture(page, 'admin-journeys', size.width); }
  });
  test('all professional roles can open subscriptions and supplier activates trial', async ({ browser }) => {
    test.setTimeout(120000);
    for (const role of ['supplier', 'driver', 'equipment_owner', 'water_septic_partner'] as const) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await context.newPage();
      await profile(page, fixtures()[role]); await page.getByText('Подписки', { exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Подписки', exact: true })).toBeVisible();
      await expect(page.getByText('Через приложение оплачиваются только подписки.', { exact: false })).toBeVisible();
      const categoryLabel = { supplier: 'Карьеры', driver: 'Водители', equipment_owner: 'Спецтехника', water_septic_partner: 'Вода' }[role];
      await expect(page.locator('section.fixed').last().getByRole('heading', { name: categoryLabel, exact: true })).toBeVisible();
      if (role === 'supplier') {
        const start = page.getByRole('button', { name: 'Активировать бесплатные 14 дней' }).first();
        if (await start.count()) { await start.click(); await expect(page.getByText('Пробный период', { exact: true })).toBeVisible(); }
        for (const size of viewports) { await page.setViewportSize(size); await capture(page, 'supplier-subscriptions', size.width); }
      } else await capture(page, `${role}-subscriptions`, 390);
      await context.close();
    }
  });
  test('general chat sends, keeps content during recovery and applies moderation', async ({ browser }) => {
    test.setTimeout(120000);
    const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await memberContext.newPage();
    await profile(page, fixtures().supplier); await page.getByText('Общий чат', { exact: true }).click();
    const draft = 'QA сообщение ' + Date.now() + '\n' + 'ДлинноеСлово'.repeat(140);
    await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill(draft);
    await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('');
    const messages = await api(browser, '/chat/messages'); const message = messages.messages.find((m: { text: string }) => m.text === draft); expect(message).toBeTruthy();
    for (const size of viewports) { await page.setViewportSize(size); await capture(page, 'general-chat', size.width); }
    await memberContext.setOffline(true); await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('QA сохранённый черновик');
    await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('QA сохранённый черновик');
    await memberContext.setOffline(false); await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue('');
    await api(browser, '/chat/moderation', { action: 'pin', message_id: message.id, reason: 'QA visual pin' });
    await expect(page.getByRole('heading', { name: 'Закреплённое' })).toBeVisible({ timeout: 15000 });
    const tombstones = page.getByText('Сообщение удалено модератором', { exact: true }); const deletedBefore = await tombstones.count();
    await api(browser, '/chat/moderation', { action: 'delete', message_id: message.id, reason: 'QA visual deletion' });
    await expect(tombstones).toHaveCount(deletedBefore + 1, { timeout: 15000 });
    await memberContext.close();
  });
  test('client confirms receipt, reviews delivery and sees direct settlement', async ({ page }) => {
    test.setTimeout(90000); const user = fixtures().client; await login(page, user); await page.goto(`/?notification_order=${user.order_id}`);
    await expect(page.getByRole('heading', { name: 'Прямые расчёты', exact: true })).toBeVisible();
    const receive = page.getByRole('button', { name: 'Подтвердить получение', exact: true });
    await expect(receive.or(page.getByText('Получение подтверждено', { exact: false }))).toBeVisible();
    if (await receive.count()) await receive.click();
    await expect(page.getByText('Получение подтверждено', { exact: false })).toBeVisible();
    const stars = page.getByRole('button', { name: 'Оценка 5', exact: true });
    await expect(stars.or(page.getByText('Ваша оценка: 5 из 5'))).toBeVisible();
    if (await stars.count()) { await stars.click(); await page.getByRole('textbox', { name: 'Текст отзыва' }).fill('QA доставка получена'); await page.getByRole('button', { name: 'Отправить отзыв', exact: true }).click(); }
    await expect(page.getByText('Ваша оценка: 5 из 5')).toBeVisible();
    for (const size of viewports) { await page.setViewportSize(size); await capture(page, 'client-receipt-review', size.width); }
    await expect(page.getByRole('button', { name: 'Оплатить заказ', exact: true })).toHaveCount(0);
  });

  test('anonymous failures, offline queue and admin contact chronology', async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext(); const visitorPage = await context.newPage();
    await visitorPage.goto('/');
    const contact = `s26-qa-${Date.now()}@example.invalid`;
    const status = await visitorPage.evaluate(async email => {
      const response = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: email, password: 'QA_NEVER_LOG_THIS_PASSWORD' }) });
      return response.status;
    }, contact);
    expect(status).toBe(401);
    const session = await visitorPage.evaluate(() => sessionStorage.getItem('darmavoz.s26.session'));
    const sensitive = await visitorPage.evaluate(() => localStorage.getItem('darmavoz.s26.events') || '');
    expect(sensitive).not.toContain(contact); expect(sensitive).not.toContain('QA_NEVER_LOG');
    await context.setOffline(true);
    await visitorPage.evaluate(async () => { try { await fetch('/api/v1/auth/login', { method: 'POST', body: '{}' }); } catch { /* Expected network failure. */ } });
    const offline = await visitorPage.evaluate(() => JSON.parse(localStorage.getItem('darmavoz.s26.events') || '[]'));
    expect(offline.some((event: { event: string }) => event.event === 'network_error')).toBeTruthy();
    await context.setOffline(false);
    await visitorPage.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => visitorPage.evaluate(() => JSON.parse(localStorage.getItem('darmavoz.s26.events') || '[]').length)).toBe(0);
    const adminContext = await browser.newContext(); const admin = await adminContext.newPage(); await login(admin, fixtures().admin);
    await admin.goto(`/admin/journeys?session=${session}`);
    await expect(admin.getByRole('heading', { name: 'Анонимное посещение', exact: true })).toBeVisible();
    await expect(admin.getByRole('heading', { name: 'Хронология', exact: true })).toBeVisible();
    await expect(admin.getByText(contact, { exact: true })).toHaveCount(0);
    await admin.getByRole('button', { name: 'Показать контакт (запись в журнале)', exact: true }).click();
    await expect(admin.getByText(contact, { exact: true })).toBeVisible();
    for (const size of viewports) { await admin.setViewportSize(size); await capture(admin, 'admin-journey-detail', size.width); }
    await context.close(); await adminContext.close();
  });
  test('chat moderation form and expiry while the chat is open', async ({ browser }) => {
    test.setTimeout(120000);
    const adminContext = await browser.newContext(); const admin = await adminContext.newPage();
    await profile(admin, fixtures().admin); await admin.getByText('Общий чат', { exact: true }).click();
    await admin.getByRole('button', { name: 'Управление чатом', exact: true }).click();
    await admin.getByRole('combobox', { name: 'Участник', exact: true }).selectOption(fixtures().supplier.id);
    await admin.getByRole('combobox', { name: 'Действие', exact: true }).selectOption('warn');
    const warning = 'QA предупреждение через форму ' + Date.now();
    await admin.getByRole('textbox', { name: 'Причина действия модератора', exact: true }).fill(warning);
    await admin.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(admin.getByRole('textbox', { name: 'Причина действия модератора', exact: true })).toHaveValue('');
    await admin.getByText('Журнал модерации', { exact: true }).click(); await expect(admin.getByText(warning, { exact: true })).toBeVisible();
    for (const size of viewports) { await admin.setViewportSize(size); await capture(admin, 'chat-moderation', size.width); }
    const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); const member = await memberContext.newPage();
    await profile(member, fixtures().supplier); await member.getByText('Общий чат', { exact: true }).click();
    await expect(member.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible();
    // This helper is restricted to the isolated database and receives a UUID argument, no credentials.
    execFileSync('docker', ['exec', 's26_qa_backend', 'python', '-c', `
import asyncio,sys
from uuid import UUID
from datetime import datetime,UTC,timedelta
from sqlalchemy import update
from sqlalchemy.engine import make_url
from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.subscriptions import CategoryAccess
async def run():
 assert make_url(str(settings.DATABASE_URL)).database=='s26qa'
 async with AsyncSessionLocal() as db:
  await db.execute(update(CategoryAccess).where(CategoryAccess.account_id==UUID(sys.argv[1])).values(trial_ends_at=datetime.now(UTC)-timedelta(seconds=1)))
  await db.commit()
asyncio.run(run())`, fixtures().supplier.id]);
    await expect(member.getByRole('button', { name: 'Выбрать подписку', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(member.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveCount(0);
    await expect(member.getByLabel('Сообщения чата')).toHaveCount(0);
    await capture(member, 'chat-expired', 390);
    await api(browser, '/subscriptions/admin/grants', { account_id: fixtures().supplier.id, category: 'quarry', starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), reason: 'QA restore after expiry check' });
    await member.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(member.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible();
    await member.setViewportSize({ width: 390, height: 420 }); await member.getByRole('textbox', { name: 'Сообщение', exact: true }).focus(); await capture(member, 'chat-short-keyboard-viewport', 390);
    await memberContext.close(); await adminContext.close();
  });

  test('paid water form keeps required fields and has no free-water option', async ({ page }) => {
    test.setTimeout(90000); await login(page, fixtures().water_septic_partner); await page.goto('/');
    await page.getByRole('button', { name: 'Добавить точку воды', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Новая точка воды', exact: true })).toBeVisible();
    await expect(page.getByText('Бесплатная вода', { exact: true })).toHaveCount(0);
    await page.getByLabel(/^Название/).fill('QA поставщик платной воды');
    await page.getByLabel(/^Источник/).fill('QA доставка воды');
    await page.getByLabel(/^Телефон/).fill('+79990000004');
    await page.getByLabel('Широта', { exact: true }).fill('57.152286'); await page.getByLabel('Долгота', { exact: true }).fill('65.534328');
    await page.getByLabel(/^Цена/).fill('1'); await page.getByLabel(/^Единица/).fill('1 м³');
    for (const size of viewports) { await page.setViewportSize(size); await page.getByRole('heading', { name: 'Новая точка воды', exact: true }).scrollIntoViewIfNeeded(); await capture(page, 'paid-water-form', size.width); }
    await page.getByLabel(/^Цена/).scrollIntoViewIfNeeded(); await capture(page, 'paid-water-price-fields', 390);
  });

  test('driver without access sees a legible map button and can open all public maps', async ({ page }) => {
    test.setTimeout(120000); await login(page, fixtures().driver); await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Новые заявки доступны по подписке', exact: true })).toBeVisible();
    const button = page.getByRole('button', { name: 'Карта материалов', exact: true });
    const colors = await button.evaluate(el => ({ foreground: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
    expect(colors.foreground).not.toBe(colors.background); expect(colors.foreground).not.toBe('rgb(255, 255, 255)');
    for (const size of viewports) { await page.setViewportSize(size); await capture(page, 'driver-notice-fixed', size.width); }
    await button.click(); await expect(page.getByRole('heading', { name: 'Общая карта', exact: true })).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Раздел карты', exact: true });
    for (const name of ['Материалы', 'Вода', 'Септики']) {
      await tabs.getByRole('tab', { name, exact: true }).click();
      for (const size of viewports) { await page.setViewportSize(size); await capture(page, 'driver-public-map-' + name, size.width); }
    }
  });

  test('pending subscription recovery stays distinct from a confirmed bank decline', async ({ page }) => {
    await login(page, fixtures().supplier);
    let declined = false;
    const row = { id: crypto.randomUUID(), request_id: crypto.randomUUID(), category: 'quarry', months: 1, amount: '1.00', created_at: new Date().toISOString(), confirmation_url: null, refunded_amount: '0.00', refunds: [] };
    await page.route('**/api/v1/subscriptions/payments', route => route.fulfill({ json: [{ ...row, status: declined ? 'canceled' : 'pending', last_error: declined ? 'provider_insufficient_funds' : 'provider_unavailable' }] }));
    await page.goto('/'); await page.getByRole('button', { name: 'Профиль', exact: true }).click(); await page.getByText('Подписки', { exact: true }).click();
    await expect(page.getByText('Связь с платёжным сервисом временно прервана. Статус платежа уточняется.', { exact: true })).toBeVisible();
    await expect(page.getByText('Оплата отклонена банком или платёжным сервисом', { exact: true })).toHaveCount(0);
    declined = true; await page.getByRole('button', { name: 'Обновить статус', exact: true }).click();
    await expect(page.getByText('Оплата отклонена банком или платёжным сервисом', { exact: true })).toBeVisible();
    await expect(page.getByText('Недостаточно средств', { exact: true })).toBeVisible();
  });

  test('subscription UI reuses uncertain purchase and permits renewal after success', async ({ page }) => {
    const requests: string[] = []; let history: Record<string, unknown>[] = [];
    await login(page, fixtures().supplier);
    await page.route('**/api/v1/subscriptions/payments', async route => {
      if (route.request().method() === 'POST') {
        const payload = route.request().postDataJSON(); requests.push(payload.request_id);
        const row = { id: crypto.randomUUID(), request_id: payload.request_id, category: 'quarry', months: 1, amount: '1.00', status: 'unknown', created_at: new Date().toISOString(), confirmation_url: null, refunded_amount: '0.00', refunds: [] };
        if (!history.some(item => item.request_id === payload.request_id)) history.push(row);
        return route.fulfill({ status: 202, json: history.find(item => item.request_id === payload.request_id) });
      }
      return route.fulfill({ json: history });
    });
    await page.goto('/'); await page.getByRole('button', { name: 'Профиль', exact: true }).click(); await page.getByText('Подписки', { exact: true }).click();
    const plan = page.getByRole('button').filter({ has: page.getByText('Тестовый тариф ЮKassa', { exact: true }) }).first();
    await expect(plan).toBeEnabled(); await plan.click(); await expect.poll(() => requests.length).toBe(1); await expect(plan).toBeEnabled();
    await plan.click(); await expect.poll(() => requests.length).toBe(2); expect(requests[1]).toBe(requests[0]);
    history = history.map(item => ({ ...item, status: 'succeeded' })); await page.getByRole('button', { name: 'Обновить статус', exact: true }).click();
    await expect(plan).toBeEnabled(); await plan.click(); await expect.poll(() => requests.length).toBe(3); expect(requests[2]).not.toBe(requests[0]);
  });
});
