import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const cityId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000002';
const orderId = '30000000-0000-4000-8000-000000000003';
const paymentId = '40000000-0000-4000-8000-000000000004';
const request = {
  id: requestId, author_id: 'author', city_id: cityId, material_id: null, material_name: 'Песок', volume: '500', unit: 'm3',
  vehicle_count: 25, pickup_address: 'Карьер, очень длинный адрес места загрузки и подъезда для крупной техники',
  delivery_address: 'Стройка, очень длинный адрес доставки с дополнительной информацией о месте разгрузки',
  starts_on: '2026-10-01', ends_on: '2026-10-10', price: '450', price_basis: 'm3', contact_name: 'Заказчик',
  contact_phone: '+79990000000', comment: 'Нужны самосвалы. Подъезд согласуем.', status: 'published', moderation_reason: null,
  is_owner: false, is_favorite: false, created_at: '2026-09-30T10:00:00Z', updated_at: '2026-09-30T10:00:00Z',
};
const payment = { id: paymentId, order_id: orderId, client_id: 'buyer', amount: '145000', currency: 'RUB', status: 'succeeded',
  payment_method: 'sbp', created_at: '2026-09-30T10:00:00Z', paid_at: '2026-09-30T10:05:00Z', refund_status: null,
  receipt_status: 'succeeded', needs_review: false, reconciliation_status: 'matched', checked_at: '2026-09-30T10:06:00Z', provider_id: 'test-provider', client_name: 'Покупатель с длинным именем организации' };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'e2e-only', role: 'admin' }, version: 0 })));
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname;
    let body: unknown = [];
    if (path.endsWith('/cities/')) body = [{ id: cityId, name: 'Тюмень', code: 'tyumen', is_active: true, is_default: true, center_lat: 57, center_lon: 65, map_zoom: 10 }];
    else if (path.endsWith('/admin/me')) body = { email: 'admin@example.invalid' };
    else if (path.endsWith('/wholesale-requests/access')) body = { enabled: true, can_moderate: true };
    else if (path.endsWith('/wholesale-requests')) body = { items: [request], total: 1, page: 1 };
    else if (path.endsWith(`/wholesale-requests/${requestId}`)) body = request;
    else if (path.endsWith('/history')) body = [{ status: 'published', reason: null, created_at: request.created_at }];
    else if (path.endsWith('/finance/payments')) body = { items: [payment], total: 1, page: 1, timezone: 'Asia/Irkutsk' };
    else if (path.endsWith('/finance/summary')) body = { paid: '145000', refunded: '0', net: '145000', successful_count: 1, failed_count: 0, timezone: 'Asia/Irkutsk' };
    else if (path.endsWith(`/payments/${paymentId}`)) body = { ...payment, events: [{ created_at: payment.paid_at, description: 'Оплачен заказ: 145000 ₽' }], refunds: [], settlement_receipt_status: null };
    else if (path.endsWith('/payments/config')) body = { enabled: false, test_mode: true, receipts_enabled: false };
    else if (path.endsWith(`/orders/${orderId}/payments`)) body = { items: [payment], quote: { amount: '145000', version: 1 }, can_pay: false };
    else if (path.endsWith('/app-version')) body = { version: '3.2.0', force_update: false };
    await route.fulfill({ json: body });
  });
});

for (const width of [320, 390, 768, 1440]) {
  test(`оптовая лента и контакты адаптированы на ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/profile');
    await page.getByRole('button', { name: /Оптовые заявки Крупные/ }).click();
    await expect(page.getByRole('heading', { name: 'Оптовые заявки', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Песок', exact: true })).toBeVisible();
    const header = page.locator('section.fixed header');
    expect(await header.evaluate(el => parseFloat(getComputedStyle(el).paddingTop))).toBeGreaterThanOrEqual(40);
    expect(await page.locator('section.fixed').evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await page.screenshot({ path: `test-results/sprint24-wholesale-${width}.png`, fullPage: true });
    await page.getByRole('heading', { name: 'Песок', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Позвонить' })).toHaveAttribute('href', 'tel:+79990000000');
    await expect(page.getByText('Подъезд согласуем.', { exact: false })).toBeVisible();
    expect(await page.locator('section.fixed').evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  });
  test(`финансовый реестр и возврат адаптированы на ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/profile');
    await page.getByRole('button', { name: /Финансы Платежи/ }).click();
    await expect(page.getByRole('heading', { name: 'Финансы', exact: true })).toBeVisible();
    await expect(page.getByText('Покупатель с длинным именем организации').filter({ visible: true })).toBeVisible();
    expect(await page.locator('section.fixed').evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await page.screenshot({ path: `test-results/sprint24-finance-${width}.png`, fullPage: true });
    await page.getByText('Покупатель с длинным именем организации').filter({ visible: true }).click();
    await page.getByRole('button', { name: 'Полный возврат', exact: true }).click();
    await expect(page.getByText('Вернуть покупателю всю сумму:', { exact: false })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Подтверждаю полный возврат' })).toBeVisible();
  });
}

test('новая оптовая заявка показывает предпросмотр перед публикацией', async ({ page }) => {
  await page.goto('/admin/profile'); await page.getByRole('button', { name: /Оптовые заявки Крупные/ }).click();
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  await page.getByLabel('Название материала', { exact: true }).fill('Щебень');
  await page.getByLabel('Общий объём', { exact: true }).fill('500');
  await page.getByLabel('Количество машин', { exact: true }).fill('25');
  await page.getByLabel('Место загрузки', { exact: true }).fill('Тюмень, карьер');
  await page.getByLabel('Место доставки', { exact: true }).fill('Тюмень, стройка');
  await page.getByLabel('Контактное лицо', { exact: true }).fill('Заказчик');
  await page.getByLabel('Телефон', { exact: true }).fill('+79990000000');
  await page.getByLabel('Цена, ₽', { exact: true }).fill('450');
  await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  await expect(page.getByText('Ищем перевозчиков. Щебень,', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отправить на проверку', exact: true })).toBeVisible();
});
