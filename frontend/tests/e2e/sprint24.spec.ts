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
    else if (path.endsWith('/admin/placements/summary')) {
      const counts = { trial: 0, active: 0, confirmation_required: 0, hidden: 0, expired: 0, archived: 0 };
      body = { totals: counts, by_entity: { quarry: counts, accumulator: counts, special_equipment: counts },
        active_quarries: 0, active_accumulators: 0, active_equipment: 0, policy: { extension_days: 30 } };
    }
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
    const header = page.locator('header').first();
    expect(await header.evaluate(el => parseFloat(getComputedStyle(el).paddingTop))).toBeGreaterThanOrEqual(40);
    expect(await page.getByRole('region', { name: 'Модерация оптовых заявок' }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await page.screenshot({ path: `test-results/sprint24-wholesale-${width}.png`, fullPage: true });
    await page.getByRole('heading', { name: 'Песок', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Позвонить' })).toHaveAttribute('href', 'tel:+79990000000');
    await expect(page.getByText('Подъезд согласуем.', { exact: false })).toBeVisible();
    expect(await page.getByRole('region', { name: 'Модерация оптовых заявок' }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
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
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'e2e-only', role: 'supplier' }, version: 0 })));
  await page.goto('/'); await page.getByRole('button', { name: 'Опт', exact: true }).click();
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  await page.getByLabel('Название материала', { exact: true }).fill('Щебень');
  await page.getByLabel('Общий объём', { exact: true }).fill('500');
  await page.getByLabel('Количество машин (необязательно)', { exact: true }).fill('25');
  await page.getByLabel('Место загрузки', { exact: true }).fill('Тюмень, карьер');
  await page.getByLabel('Место доставки', { exact: true }).fill('Тюмень, стройка');
  await page.getByLabel('Контактное лицо', { exact: true }).fill('Заказчик');
  await page.getByLabel('Телефон', { exact: true }).fill('+79990000000');
  await page.getByLabel('Цена, ₽', { exact: true }).fill('450');
  await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  await expect(page.getByTestId('wholesale-request-card').getByRole('heading', { name: 'Щебень', exact: true })).toBeVisible();
  await expect(page.getByText('Нужно машин: 25', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отправить на модерацию', exact: true })).toBeVisible();
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
      await expect(tab).toHaveAttribute('aria-current', 'page');
      // Visibility alone misses a fullscreen layer intercepting the navigation.
      await tab.click({ trial: true });
      const bell = page.locator('section.fixed header').getByRole('button', { name: 'Открыть уведомления' });
      await expect(bell).toBeVisible();
      await bell.click({ trial: true });
      await page.screenshot({ path: `test-results/wholesale-nav-${role}-${width}.png`, fullPage: true });
      await page.locator('section.fixed').getByRole('button', { name: 'Назад', exact: true }).click();
      await expect(tab).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Оптовые заявки', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Профиль', exact: true }).click();
      await page.getByRole('button', { name: /Оптовые заявки Крупные/ }).click();
      await expect(tab).toHaveAttribute('aria-current', 'page');
      await page.getByRole('button', { name: 'Профиль', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'На модерации', exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Песок', exact: true }).click();
  await page.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Отклонить заявку', exact: true })).toBeDisabled();
  await page.getByLabel('Причина отклонения', { exact: true }).fill('Уточните место загрузки');
  await page.getByRole('button', { name: 'Отклонить заявку', exact: true }).click();
  await expect(page.getByLabel('Причина отклонения', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('wholesale-request-card').getByText('Уточните место загрузки', { exact: true })).toBeVisible();

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
  await page.getByRole('button', { name: 'Отправить на модерацию', exact: true }).click();
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

test('форма опта загружает каталог, переключает ручной материал и маскирует телефон', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({
    state: { token: 'e2e-only', role: 'supplier' }, version: 0,
  })));
  await page.route('**/catalog/materials/**', route => route.fulfill({ json: [
    { id: '50000000-0000-4000-8000-000000000005', name: 'Щебень из каталога' },
  ] }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Опт', exact: true }).click();
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  await page.getByLabel('Материал', { exact: true }).selectOption('50000000-0000-4000-8000-000000000005');
  await expect(page.getByLabel('Название материала')).toHaveCount(0);
  await page.getByLabel('Материал', { exact: true }).selectOption('');
  await page.getByLabel('Название материала').fill('Свой материал');
  await page.getByLabel('Телефон', { exact: true }).fill('89041146809');
  await expect(page.getByLabel('Телефон', { exact: true })).toHaveValue('+7 (904) 114-68-09');
  await page.getByLabel('Телефон', { exact: true }).fill('123');
  expect(await page.getByLabel('Телефон', { exact: true }).evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
  await page.getByRole('button', { name: 'Опт', exact: true }).click({ trial: true });
  await page.getByRole('button', { name: 'Точки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Новая оптовая заявка' })).toHaveCount(0);
});

test('адреса опта используют подсказки 2GIS и сохраняют выбранный адрес', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({
    state: { token: 'e2e-only', role: 'supplier' }, version: 0,
  })));
  const searches: URL[] = [];
  await page.route('https://catalog.api.2gis.com/3.0/suggests**', route => {
    searches.push(new URL(route.request().url()));
    return route.fulfill({ json: { result: { items: [
      { id: 'suggest-1', full_address_name: 'Тюмень, улица Республики, 10', type: 'building' },
    ] } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Опт', exact: true }).click();
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  await page.getByLabel('Город загрузки', { exact: true }).selectOption(cityId);
  for (const label of ['Место загрузки', 'Место доставки']) {
    await page.getByLabel(label, { exact: true }).fill('Республики');
    await page.getByRole('listbox').getByRole('button', { name: 'Тюмень, улица Республики, 10' }).click();
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('Тюмень, улица Республики, 10');
  }
  expect(searches[0].searchParams.get('location')).toBe('65,57');
  expect(searches[1].searchParams.has('location')).toBe(false);
});

test('карточка без количества машин одинакова в предпросмотре, модерации и ленте', async ({ page }) => {
  await page.route('**/wholesale-requests**', async route => {
    const row = { ...request, material_name: 'Бой кирпича', volume: '30', vehicle_count: null,
      starts_on: '2026-10-02', ends_on: '2026-10-02', status: 'pending' };
    const url = new URL(route.request().url());
    const feed = url.pathname.endsWith('/wholesale-requests');
    const role = await page.evaluate(() => JSON.parse(localStorage.getItem('auth-storage')!).state.role);
    if (url.pathname.endsWith('/history')) return route.fulfill({ json: [] });
    await route.fulfill({ json: feed ? { items: [{ ...row, status: role === 'driver' ? 'approved' : 'pending' }], total: 1 } : row });
  });
  await page.goto('/admin/profile');
  await page.getByRole('button', { name: /Оптовые заявки Крупные/ }).click();
  const card = page.getByTestId('wholesale-request-card');
  await expect(card.getByRole('heading', { name: 'Бой кирпича' })).toBeVisible();
  await expect(card.getByText('30 м³', { exact: true })).toBeVisible();
  await expect(card.getByText('2 октября 2026 г.', { exact: true })).toBeVisible();
  await expect(card.getByText(/Нужно машин/)).toHaveCount(0);
  await expect(card.getByText('+7 (999) 000-00-00', { exact: true })).toBeVisible();
  await card.getByRole('heading', { name: 'Бой кирпича' }).click();
  await expect(page.getByRole('button', { name: 'Одобрить', exact: true })).toBeVisible();
  await expect(card.getByText('2 октября 2026 г.', { exact: true })).toBeVisible();
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'e2e-only', role: 'supplier' }, version: 0 })));
  await page.goto('/'); await page.getByRole('button', { name: 'Опт', exact: true }).click();
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  await page.getByLabel('Название материала', { exact: true }).fill('Бой кирпича');
  await page.getByLabel('Общий объём', { exact: true }).fill('30');
  const count = page.getByLabel('Количество машин (необязательно)', { exact: true });
  expect(await count.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
  await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'Бой кирпича' })).toBeVisible();
  await expect(card.getByText(/Нужно машин/)).toHaveCount(0);
  await count.fill('2');
  await expect(card.getByText('Нужно машин: 2', { exact: true })).toBeVisible();
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({
    state: { token: 'e2e-only', role: 'driver' }, version: 0,
  })));
  await page.goto('/');
  await page.getByRole('button', { name: 'Опт', exact: true }).click();
  await expect(card.getByText('Опубликовано', { exact: true })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Бой кирпича' })).toBeVisible();
  await expect(card.getByText(/Нужно машин/)).toHaveCount(0);
});

test('сохранение формы без количества машин передаёт null', async ({ page }) => {
  let saved: any;
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({
    state: { token: 'e2e-only', role: 'supplier' }, version: 0,
  })));
  await page.route('**/wholesale-requests**', route => {
    if (route.request().method() === 'POST') {
      saved = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { ...request, ...saved, status: 'pending', is_owner: true } });
    }
    return route.fulfill({ json: { items: saved ? [{ ...request, ...saved, status: 'pending', is_owner: true }] : [], total: saved ? 1 : 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Опт', exact: true }).click();
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  await page.getByLabel('Город загрузки', { exact: true }).selectOption(cityId);
  for (const [label, value] of [['Название материала', 'Бой кирпича'], ['Общий объём', '30'],
    ['Место загрузки', 'Карьер А'], ['Место доставки', 'Стройка Б'],
    ['Контактное лицо', 'Автор'], ['Телефон', '+79990000000'], ['Цена, ₽', '150']]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByRole('button', { name: 'Отправить на модерацию', exact: true }).click();
  await expect(page.getByText('На модерации', { exact: true })).toBeVisible();
  expect(saved.vehicle_count).toBeNull();
  await expect(page.getByTestId('wholesale-request-card').getByText(/Нужно машин/)).toHaveCount(0);
});

for (const width of [390, 1440]) {
  test(`админ открывает оптовую модерацию из меню на ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/catalog');
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await page.getByRole('complementary', { name: 'Навигация администратора' }).getByRole('button', { name: 'Оптовые заявки', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/wholesale$/);
    await expect(page.getByRole('heading', { name: 'Оптовые заявки', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'На модерации', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Оптовые заявки', exact: true })).toBeVisible();
  });
}
test('уведомление админа открывает оптовую модерацию и конкретную заявку', async ({ page }) => {
  await page.route('**/notifications**', route => route.fulfill({ json: route.request().url().includes('unread-count')
    ? { count: 1 } : [{ id: requestId, title: 'Новая оптовая заявка', body: 'Требуется проверка заявки.',
      is_read: false, payload: { wholesale_request_id: requestId, status: 'pending' } }] }));
  await page.goto('/admin/catalog');
  await page.getByRole('button', { name: 'Открыть уведомления', exact: true }).click();
  await page.getByRole('dialog', { name: 'Центр уведомлений' }).getByRole('button', { name: /Новая оптовая заявка/ }).click();
  await expect(page).toHaveURL(new RegExp('/admin/wholesale[?]notification_wholesale=' + requestId));
  await expect(page.getByTestId('wholesale-request-card').getByRole('heading', { name: 'Песок', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'История', exact: true })).toBeVisible();
});
test('своя карточка скрывает звонок, сокращает маршрут и разделяет действия', async ({ page }) => {
  const row = { ...request, is_owner: true, pickup_address: 'Россия, Тюменская область, Тюмень, улица Республики, 10',
    delivery_address: 'Россия, муниципальный округ Тюмень, Тюмень, улица Ленина, 20' };
  await page.route('**/wholesale-requests**', route => route.fulfill({ json:
    new URL(route.request().url()).pathname.endsWith('/wholesale-requests') ? { items: [row], total: 1 } : row }));
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'e2e-only', role: 'supplier' }, version: 0 })));
  await page.goto('/'); await page.getByRole('button', { name: 'Опт', exact: true }).click();
  const card = page.getByTestId('wholesale-request-card');
  await expect(card.getByRole('link', { name: 'Позвонить', exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Скопировать номер', exact: true })).toHaveCount(0);
  await expect(card.getByText(/Россия|Тюменская область|муниципальный/)).toHaveCount(0);
  await expect(card.getByText(/Тюмень, улица Республики, 10/)).toBeVisible();
  const more = card.getByRole('button', { name: 'Подробнее о заявке', exact: true });
  const edit = card.getByRole('button', { name: 'Редактировать', exact: true });
  const first = await more.boundingBox(), second = await edit.boundingBox();
  expect(first!.y + first!.height <= second!.y || first!.x + first!.width < second!.x).toBe(true);
});

for (const width of [320, 390, 768, 1440]) {
  test(`отдельный экран админа сохраняет layout и модерирует карточки на ${width}px`, async ({ page }) => {
    let current = { ...request, status: 'pending', reject_reason: null as string | null };
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/wholesale-requests**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/moderate')) {
        const body = route.request().postDataJSON();
        current = { ...current, status: body.action === 'approve' ? 'approved' : 'rejected', reject_reason: body.reason || null };
        return route.fulfill({ json: current });
      }
      if (url.pathname.endsWith('/history')) return route.fulfill({ json: [] });
      if (url.pathname.endsWith(requestId)) return route.fulfill({ json: current });
      expect(url.searchParams.get('view')).toBe('moderation');
      const status = url.searchParams.get('status');
      return route.fulfill({ json: { items: status === current.status || status === 'all' ? [current] : [], total: status === current.status || status === 'all' ? 1 : 0 } });
    });
    await page.goto('/admin/wholesale');
    await expect(page.locator('header').first().getByText('Панель администратора', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Открыть уведомления', exact: true })).toBeVisible();
    for (const name of ['Создать заявку', 'Мои заявки', 'Избранное', 'Редактировать'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.getByText('Найдите перевозчиков', { exact: true })).toHaveCount(0);
    const card = page.getByTestId('wholesale-request-card');
    await expect(card.getByRole('button', { name: 'Одобрить', exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Отклонить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Отклонить заявку', exact: true })).toBeDisabled();
    await page.getByLabel('Причина отклонения', { exact: true }).fill('Укажите более точный адрес доставки');
    await page.getByRole('button', { name: 'Отклонить заявку', exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.getByRole('button', { name: 'Отклонённые', exact: true }).click();
    await expect(card.getByText('Укажите более точный адрес доставки', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Одобрить', exact: true })).toHaveCount(0);
    current = { ...current, status: 'pending', reject_reason: null };
    await page.getByRole('button', { name: 'На модерации', exact: true }).click();
    await card.getByRole('button', { name: 'Одобрить', exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.getByRole('button', { name: 'Активные', exact: true }).click();
    await expect(card.getByText('Опубликовано', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    const nav = page.getByRole('complementary', { name: 'Навигация администратора' });
    await expect(nav.getByRole('button', { name: 'Оптовые заявки', exact: true })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('button', { name: 'Поставщики', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/suppliers$/);
  });
}

test('поставщик сохраняет черновик, редактирует и отправляет на модерацию', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'e2e-only', role: 'supplier' }, version: 0 })));
  let saved: any = null;
  await page.route('**/wholesale-requests**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'POST' || method === 'PUT') {
      saved = { ...request, ...route.request().postDataJSON(), is_owner: true,
        status: url.searchParams.get('draft') === 'true' ? 'draft' : 'pending' };
      return route.fulfill({ status: method === 'POST' ? 201 : 200, json: saved });
    }
    return route.fulfill({ json: { items: saved ? [saved] : [], total: saved ? 1 : 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Опт', exact: true }).click();
  await page.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  await page.getByLabel('Город загрузки', { exact: true }).selectOption(cityId);
  for (const [label, value] of [['Название материала', 'Черновик песка'], ['Общий объём', '30'],
    ['Место загрузки', 'Карьер А'], ['Место доставки', 'Стройка Б'], ['Контактное лицо', 'Автор'],
    ['Телефон', '+79990000000'], ['Цена, ₽', '150']]) await page.getByLabel(label, { exact: true }).fill(value);
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  await expect(page.getByTestId('wholesale-request-card').getByRole('heading', { name: 'Черновик песка' })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Мои заявки', exact: true })).toBeVisible();
  await expect(page.getByText('Черновик', { exact: true })).toBeVisible();
  expect(saved.status).toBe('draft');
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(page.getByLabel('Место доставки', { exact: true })).toHaveValue('Стройка Б');
  await page.getByLabel('Место доставки', { exact: true }).fill('Стройка Б, улица 10');
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(page.getByText('Черновик', { exact: true })).toBeVisible();
  expect(saved.delivery_address).toBe('Стройка Б, улица 10');
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByRole('button', { name: 'Отправить на модерацию', exact: true }).click();
  await expect(page.getByText('На модерации', { exact: true })).toBeVisible();
  await expect(page.getByText('Черновик', { exact: true })).toHaveCount(0);
  expect(saved.status).toBe('pending');
});
