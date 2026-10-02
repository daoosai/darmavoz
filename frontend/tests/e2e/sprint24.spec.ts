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
  contact_phone: '+79990000000', comment: 'Нужны самосвалы. Подъезд согласуем.', status: 'approved', reject_reason: null,
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
    else if (path.endsWith('/history')) body = [{ status: 'approved', reason: null, created_at: request.created_at }];
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

// Start in the partner cabinet and click its navigation, never a wholesale URL.
for (const role of ['driver', 'supplier']) {
  for (const width of [320, 1440]) {
    test(`партнёр ${role} открывает Опт из навигации на ${width}px`, async ({ page }) => {
      await page.addInitScript(role => localStorage.setItem('auth-storage', JSON.stringify({
        state: { token: 'e2e-only', role }, version: 0,
      })), role);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const tab = page.getByRole('button', { name: 'Опт', exact: true });
      await expect(tab).toBeVisible();
      const bounds = await tab.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await tab.click();
      await expect(page.getByRole('heading', { name: 'Оптовые заявки', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Песок', exact: true })).toBeVisible();
      await page.screenshot({ path: `test-results/wholesale-nav-${role}-${width}.png`, fullPage: true });
      await page.locator('section.fixed').getByRole('button', { name: 'Назад', exact: true }).click();
      await expect(tab).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Оптовые заявки', exact: true })).toHaveCount(0);
    });
  }
}

for (const role of ['supplier', 'driver']) {
  test(`партнёр ${role} создаёт заявку без whitelist API`, async ({ page }) => {
    await page.addInitScript(role => localStorage.setItem('auth-storage', JSON.stringify({
      state: { token: 'e2e-only', role }, version: 0,
    })), role);
    let accessCalls = 0;
    await page.route('**/wholesale-requests/access', route => {
      accessCalls += 1;
      return route.fulfill({ json: { enabled: false, can_moderate: false } });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Опт', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Песок', exact: true })).toBeVisible();
    await expect(page.getByText('Раздел для допущенных партнёров')).toHaveCount(0);
    await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Новая оптовая заявка', exact: true })).toBeVisible();
    expect(accessCalls).toBe(0);
  });
}

test('у клиента B2C нет вкладки Опт', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({
    state: { token: 'e2e-only', role: 'client' }, version: 0,
  })));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Главная', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Опт', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Оптовые заявки/ })).toHaveCount(0);
});

for (const role of ['equipment_owner', 'water_septic_partner']) {
  for (const width of [320, 1440]) {
    test(`партнёр ${role} не видит Опт даже с допуском на ${width}px`, async ({ page }) => {
      await page.addInitScript(role => localStorage.setItem('auth-storage', JSON.stringify({
        state: { token: 'e2e-only', role }, version: 0,
      })), role);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const profile = page.getByRole('button', { name: 'Профиль', exact: true });
      await expect(profile).toBeVisible();
      await expect(page.getByRole('button', { name: 'Опт', exact: true })).toHaveCount(0);
      await profile.click();
      await expect(page.getByRole('button', { name: 'Опт', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Оптовые заявки/ })).toHaveCount(0);
    });
  }
}

test('модерация: причина обязательна, отклонённая заявка исправляется и одобряется', async ({ page }) => {
  let current = { ...request, status: 'pending', reject_reason: null as string | null, is_owner: false };
  await page.route('**/wholesale-requests**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith('/moderate')) {
      const data = route.request().postDataJSON();
      current = { ...current, status: data.action === 'reject' ? 'rejected' : 'approved', reject_reason: data.action === 'reject' ? data.reason : null };
      return route.fulfill({ json: current });
    }
    if (method === 'PUT' && url.pathname.endsWith(requestId)) {
      current = { ...current, ...route.request().postDataJSON(), status: 'pending', reject_reason: null };
      return route.fulfill({ json: current });
    }
    if (url.pathname.endsWith('/history')) return route.fulfill({ json: [] });
    if (url.pathname.endsWith(requestId)) return route.fulfill({ json: current });
    return route.fulfill({ json: { items: [current], total: 1, page: 1 } });
  });
  await page.goto('/admin/moderation');
  await page.getByRole('button', { name: /Оптовые заявки Модерация заявок/ }).click();
  await expect(page.locator('section.fixed').getByRole('button', { name: 'Модерация', exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Песок', exact: true }).click();
  await page.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Отклонить заявку', exact: true })).toBeDisabled();
  await page.getByLabel('Причина отклонения', { exact: true }).fill('Уточните место загрузки');
  await page.getByRole('button', { name: 'Отклонить заявку', exact: true }).click();
  await expect(page.getByLabel('Причина отклонения', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Уточните место загрузки', { exact: true })).toBeVisible();

  current = { ...current, is_owner: true };
  await page.evaluate(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'e2e-only', role: 'supplier' }, version: 0 })));
  // The global init script is admin; the last init script sets the supplier role.
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'e2e-only', role: 'supplier' }, version: 0 })));
  await page.goto('/');
  await page.getByRole('button', { name: 'Опт', exact: true }).click();
  await page.getByRole('button', { name: 'Мои заявки', exact: true }).click();
  await expect(page.getByText('Отклонено', { exact: true })).toBeVisible();
  await expect(page.getByText('Причина отклонения: Уточните место загрузки', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(page.getByLabel('Название материала', { exact: true })).toHaveValue('Песок');
  await page.getByLabel('Место доставки', { exact: true }).fill('Стройка Б, улица Тестовая 10');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('На модерации', { exact: true })).toBeVisible();
  await expect(page.getByText('Причина отклонения:', { exact: false })).toHaveCount(0);

  current = { ...current, is_owner: false };
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'e2e-only', role: 'admin' }, version: 0 })));
  await page.goto('/admin/moderation');
  await page.getByRole('button', { name: /Оптовые заявки Модерация заявок/ }).click();
  await page.getByRole('heading', { name: 'Песок', exact: true }).click();
  await page.getByRole('button', { name: 'Одобрить', exact: true }).click();
  await expect(page.getByText('Опубликовано', { exact: true })).toBeVisible();
});

test('колокольчик опта открывает уведомление и конкретную отклонённую заявку', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({
    state: { token: 'e2e-only', role: 'supplier' }, version: 0,
  })));
  const reason = 'Укажите более точный адрес доставки';
  await page.route('**/notifications**', route => route.fulfill({ json:
    route.request().url().includes('unread-count') ? { count: 1 } :
    route.request().method() === 'PATCH' ? { ok: true } :
    [{ id: requestId, title: 'Оптовая заявка отклонена', body: 'Причина: ' + reason, is_read: false,
       payload: { wholesale_request_id: requestId } }],
  }));
  await page.route(`**/wholesale-requests/${requestId}`, route => route.fulfill({ json: { ...request, is_owner: true, status: 'rejected', reject_reason: reason } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Опт', exact: true }).click();
  await page.locator('section.fixed').getByRole('button', { name: 'Открыть уведомления', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Центр уведомлений', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Оптовая заявка отклонена Причина:/ }).click();
  await expect(page).toHaveURL(new RegExp('notification_wholesale=' + requestId));
  await expect(page.locator('section.fixed').getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible();
});
