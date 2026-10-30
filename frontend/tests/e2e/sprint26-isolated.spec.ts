/** Opt-in real API/browser tests against the disposable S26 QA backend.
 * Never point these tests at production. Auth fixture stays outside git.
 */
import { expect, test, type Page, type Browser } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
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
});
