import { test, expect, type Browser, type Page } from '@playwright/test';

// Sessions and API are isolated from working databases. Mutations are shared across
// role contexts within a test; dispatch filtering itself runs in the real React UI.
test.use({ serviceWorkers: 'block' });
test.setTimeout(60_000);
const tyumen = '10000000-0000-4000-8000-000000000001';
const ekb = '10000000-0000-4000-8000-000000000002';
const driverId = '20000000-0000-4000-8000-000000000001';
const driverName = 'Тестовый водитель Тюмени';
const cities = [
  { id: tyumen, name: 'Тюмень', region: 'Тюменская область', code: 'tyumen', is_default: true },
  { id: ekb, name: 'Екатеринбург', region: 'Свердловская область', code: 'ekaterinburg', is_default: false },
].map(city => ({ ...city, is_active: true, center_lat: 57.15, center_lon: 65.53, map_zoom: 11 }));
const options = [10, 30].map(capacity => ({ id: `option-${capacity}`, title: capacity === 10 ? 'Средние машины (10 м³)' : 'Большие самосвалы (30 м³)', capacity_m3: capacity, is_active: true }));
const material = { id: 'material-sand', name: 'Песок', unit: 'м³', price: 450, description: 'Песок для E2E', delivery_options: options };
const vehicle = { id: 'vehicle-10', brand: 'КАМАЗ', plate_number: 'А001АА72', vehicle_type: 'Самосвал', cubature_min: 10, cubature_max: 10, body_volume_m3: 10, delivery_option: options[0], is_active: true, media_files: [] };
const initialDriver = () => ({ id: driverId, name: driverName, phone: '+79990000001', city_ids: [tyumen], city_names: ['Тюмень'], status: 'available', is_active: true, is_on_shift: false, moderation_status: 'approved', vehicle_moderation_status: 'approved', dispatch_exclusion_reasons: [], vehicle });
type State = { driver: ReturnType<typeof initialDriver>; announcement: any; orders: any[]; registration: any; checkouts: any[]; cityQueries: string[] };
const state = (): State => ({ driver: initialDriver(), announcement: null, orders: [], registration: null, checkouts: [], cityQueries: [] });

async function session(browser: Browser, db: State, role: string | null, path = '/', capacity?: number) {
  const context = await browser.newContext({ ...(role === 'logist' ? { viewport: { width: 390, height: 844 } } : {}), serviceWorkers: 'block', permissions: ['geolocation'], geolocation: { latitude: 57.15, longitude: 65.53 } });
  await context.addInitScript(({ role, tyumen, driverId, material, options, capacity }) => {
    const persist = (key: string, state: unknown, version = 0) => localStorage.setItem(key, JSON.stringify({ state, version }));
    if (role) persist('auth-storage', { token: `e2e-${role}`, role, driverId: role === 'driver' ? driverId : null });
    persist('selected-city', { cityId: tyumen }, 1);
    persist('address-storage', { selectedAddress: 'Тюмень, улица Республики, 1', selectedAddressCoordinates: { lat: 57.15, lon: 65.53 } });
    if (capacity) persist('cart-storage', { cartCityId: tyumen, cityCarts: {}, cartItems: [{ id: 'cart-sand', material, deliveryOption: options.find(o => o.capacity_m3 === capacity), quantity: 1, volume: capacity }] }, 1);
  }, { role, tyumen, driverId, material, options, capacity });
  await context.route('**/api/v1/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/v1', '').replace(/\/$/, '');
    const method = req.method();
    const body = req.postData() ? req.postDataJSON() : {};
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === '/cities' || path === '/operator/cities') return json(cities);
    if (path === '/wholesale-requests/access') return json({ enabled: role !== 'client', can_moderate: role === 'admin' });
    if (path === '/wholesale-requests') {
      if (method === 'POST') {
        db.announcement = { ...body, id: 'wholesale-sand', author_id: 'supplier', status: 'draft', moderation_reason: null, is_favorite: false, created_at: new Date().toISOString() };
        return json({ ...db.announcement, is_owner: true }, 201);
      }
      const view = url.searchParams.get('view');
      const visible = db.announcement && (view === 'moderation' ? role === 'admin' && db.announcement.status === 'pending_moderation' : view === 'mine' ? role === 'supplier' : db.announcement.status === 'published');
      return json({ items: visible ? [{ ...db.announcement, is_owner: role === 'supplier' }] : [], total: visible ? 1 : 0, page: 1 });
    }
    if (path.startsWith('/wholesale-requests/wholesale-sand')) {
      if (path.endsWith('/history')) return json([]);
      if (path.endsWith('/submit')) db.announcement.status = 'pending_moderation';
      if (path.endsWith('/moderate')) {
        expect(role).toBe('admin'); expect(body.action).toBe('publish');
        db.announcement.status = 'published';
      }
      return json({ ...db.announcement, is_owner: role === 'supplier' });
    }
    if (path === '/auth/driver/register') {
      db.registration = body;
      db.driver = { ...initialDriver(), name: body.name, city_ids: [], city_names: [], status: 'offline', vehicle: { ...vehicle, cubature_min: body.cubature_min, cubature_max: body.cubature_max } };
      return json({ status: 'sms_sent', phone: body.phone });
    }
    if (path === '/driver/auth/verify-register') return json({ access_token: 'e2e-driver', role: 'driver', driver_id: driverId });
    if (path === '/driver/profile/full') return json(db.driver);
    if (path === '/driver/profile/shift') {
      db.driver.is_on_shift = body.is_on_shift; db.driver.status = body.is_on_shift ? 'available' : 'offline';
      return json(db.driver);
    }
    if (path === `/admin/drivers/${driverId}/cities`) {
      if (method === 'PATCH') { db.driver.city_ids = body.city_ids; db.driver.city_names = cities.filter(c => body.city_ids.includes(c.id)).map(c => c.name); }
      return json({ city_ids: db.driver.city_ids });
    }
    if (path === '/admin/drivers') {
      const city = url.searchParams.get('city_id') || '';
      db.cityQueries.push(city);
      return json(!city || db.driver.city_ids.includes(city) ? [db.driver] : []);
    }
    if (path === '/client/orders/calculate') return json({ best_option: { quarry_id: 'quarry-sand', quarry_name: 'Тестовый карьер', point_type: 'quarry', distance: 5, material_cost: body.volume * 450, delivery_cost: 1000, total_amount: body.volume * 450 + 1000, trip_count: Math.ceil(body.volume / (body.delivery_option_id === 'option-10' ? 10 : 30)) }, alternatives: [] });
    if (path === '/orders/checkout') {
      expect(role).toBe('client');
      db.checkouts.push(body);
      const option = options.find(o => o.id === body.delivery_option_id)!;
      const order = { ...body, id: `order-${option.capacity_m3}`, status: 'no_driver_found', city_id: tyumen, city_name: 'Тюмень', delivery_address: body.address, delivery_option: option, total_amount: 46000, estimated_total_amount: 46000, created_at: new Date().toISOString(), items: [{ material, quantity: body.quantity, volume: body.volume }], client: { name: 'Клиент E2E', phone: '+79990000002' }, driver: null, trip_count: Math.ceil(body.volume / option.capacity_m3) };
      db.orders.push(order); return json(order, 201);
    }
    if (path === '/logist/orders' || path === '/clients/me/orders') return json(db.orders);
    if (path.includes('driver-recommendations')) return json({ candidates: [], not_recommended: [], calculated_at: new Date().toISOString(), distance_source: 'straight_line' });
    if (/^\/orders\/[^/]+\/payments$/.test(path)) return json({ items: [], quote: null, can_pay: false, requires_refund_review: false });
    if (path === '/payments/config') return json({ enabled: false, receipts_enabled: false });
    if (path === '/catalog/materials') return json([material]);
    if (path === '/catalog/delivery-options') return json(options);
    if (path === `/admin/drivers/${driverId}` && method === 'PATCH') {
      db.driver.vehicle = { ...db.driver.vehicle, cubature_min: body.cubature_min, cubature_max: body.cubature_max };
      return json(db.driver);
    }
    if (path === '/clients/me' || path === '/supplier/me' || path === '/admin/me' || path === '/logist/me') return json({ id: 'user-e2e', name: 'Пользователь E2E', full_name: 'Пользователь E2E', phone: '+79990000002', email: 'e2e@example.invalid', is_active: true });
    if (path.includes('notifications')) return json({ items: [], total: 0, unread_count: 0 });
    // Non-business background requests; never allow an API request to reach a real DB.
    return json([]);
  });
  const page = await context.newPage();
  page.on('pageerror', error => console.error(`E2E browser error: ${error.message}`));
  await page.goto(path);
  return page;
}
async function profile(page: Page) { await page.getByRole('button', { name: 'Профиль', exact: true }).last().click(); }
async function wholesale(page: Page) { await page.getByRole('button', { name: /Оптовые заявки Крупные/ }).click(); await expect(page.getByRole('heading', { name: 'Оптовые заявки', exact: true })).toBeVisible(); }
test.afterEach(async ({ browser }) => { await Promise.all(browser.contexts().map(c => c.close())); });

test('Спринт 24: оптовая заявка — клиент, поставщик, модерация, водитель', async ({ browser }) => {
  const db = state();
  const client = await session(browser, db, 'client'); await profile(client);
  await expect(client.getByRole('heading', { name: 'Пользователь E2E', exact: true })).toBeVisible();
  await expect(client.getByRole('button', { name: /Оптовые заявки/ })).toHaveCount(0);
  await client.context().close();
  const supplier = await session(browser, db, 'supplier', '/supplier'); await profile(supplier); await wholesale(supplier);
  await supplier.getByRole('button', { name: 'Создать заявку' }).click();
  for (const [label, value] of Object.entries({ 'Название материала': 'Песок', 'Общий объём': '500', 'Количество машин': '25', 'Место загрузки': 'Тюмень, карьер', 'Место доставки': 'Тюмень, стройплощадка', 'Контактное лицо': 'Партнёр E2E', 'Телефон': '+79990000002', 'Цена, ₽': '450' })) await supplier.getByLabel(label, { exact: true }).fill(value);
  await supplier.getByRole('button', { name: 'Предпросмотр' }).click();
  await supplier.getByRole('button', { name: 'Отправить на проверку' }).click();
  await expect.poll(() => db.announcement?.status).toBe('pending_moderation');
  expect(Number(db.announcement.volume)).toBe(500); expect(db.announcement.vehicle_count).toBe(25);
  await supplier.context().close();
  const driver = await session(browser, db, 'driver', '/driver'); await profile(driver); await wholesale(driver);
  await expect(driver.getByText('Заявок пока нет', { exact: true })).toBeVisible();
  const admin = await session(browser, db, 'admin', '/admin/profile'); await wholesale(admin);
  await admin.getByRole('button', { name: 'Проверка', exact: true }).click();
  await admin.getByRole('heading', { name: 'Песок', exact: true }).click();
  await admin.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(admin.getByText('Опубликована', { exact: true })).toBeVisible();
  await admin.context().close();
  await driver.reload(); await profile(driver); await wholesale(driver);
  await expect(driver.getByRole('heading', { name: 'Песок', exact: true })).toBeVisible();
  await expect(driver.getByText('500 м³ · 25 машин', { exact: true })).toBeVisible();
});

test('Спринт 25: регистрация без города, логист назначает Тюмень и машину, смена', async ({ browser }) => {
  const db = state();
  const driver = await session(browser, db, null);
  await driver.getByRole('button', { name: 'Вход для партнеров' }).click();
  await driver.getByRole('button', { name: 'Регистрация самосвалов' }).click();
  await expect(driver.getByRole('heading', { name: 'Регистрация водителя', exact: true })).toBeVisible();
  await expect(driver.getByRole('combobox', { name: /Город/ })).toHaveCount(0);
  await expect(driver.getByText(/Выберите город/)).toHaveCount(0);
  for (const [placeholder, value] of Object.entries({ 'Иванов Иван Иванович': driverName, '+7 (999) 000-00-00': '+79990000001', 'Придумайте пароль': 'E2ePassword123', 'Например, КАМАЗ': 'КАМАЗ', 'А000АА77': 'А001АА72' })) await driver.getByPlaceholder(placeholder, { exact: true }).fill(value);
  await driver.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await expect(driver.getByRole('heading', { name: 'Подтвердите номер' })).toBeVisible();
  for (let i = 0; i < 4; i++) await driver.locator('input[maxlength="1"]').nth(i).fill('1');
  await profile(driver);
  await expect(driver.getByText('Город не назначен. Обратитесь к логисту', { exact: true })).toBeVisible();
  expect(db.registration).not.toHaveProperty('city_id'); expect(db.registration).not.toHaveProperty('city_ids');
  const logist = await session(browser, db, 'logist', '/logist/orders');
  await logist.getByRole('button', { name: 'Водители', exact: true }).first().click();
  await logist.getByRole('button', { name: 'Города обслуживания', exact: true }).click();
  await logist.getByRole('checkbox', { name: 'Тюмень, Тюменская область' }).check();
  await logist.getByRole('button', { name: 'Сохранить города' }).click();
  await expect.poll(() => db.driver.city_ids).toEqual([tyumen]);
  await driver.reload(); await profile(driver);
  await expect(driver.getByText('Тюмень', { exact: true })).toBeVisible();
  // Soft assertions let the shift check run even when the missing logist vehicle UI is detected.
  const editVehicle = logist.getByRole('button', { name: /Редактировать|Назначить машину/ });
  await expect.soft(editVehicle, 'Логист должен иметь управление машиной водителя (10 м³)').toBeVisible();
  if (await editVehicle.count()) {
    await editVehicle.click();
    await logist.getByPlaceholder('От', { exact: true }).first().fill('10');
    await logist.getByPlaceholder('До', { exact: true }).first().fill('10');
    await logist.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect.soft.poll(() => db.driver.vehicle.cubature_max).toBe(10);
  }
  expect.soft(db.driver.vehicle.cubature_max, 'Логист назначил машину с кубатурой 10 м³').toBe(10);
  await driver.getByRole('button', { name: 'Заказы', exact: true }).last().click();
  await driver.getByRole('switch', { name: 'Начать смену', exact: true }).click();
  await expect.poll(() => db.driver.is_on_shift).toBe(true);
  await profile(driver);
  await expect(driver.getByRole('switch', { name: 'На смене', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('Спринт 25: глобальный фильтр админки исключает водителя другого города', async ({ browser }) => {
  const db = state();
  const admin = await session(browser, db, 'admin', '/admin/drivers');
  await admin.getByLabel('Город', { exact: true }).selectOption(tyumen);
  await expect(admin.getByRole('cell').filter({ hasText: driverName }).first()).toBeVisible();
  await admin.getByLabel('Город', { exact: true }).selectOption(ekb);
  await expect.poll(() => db.cityQueries.at(-1)).toBe(ekb);
  await expect(admin.getByText(driverName, { exact: true })).toHaveCount(0);
});

test('Спринт 25: 100 м³ — ручной подбор по кубатуре рейса 10/30 м³', async ({ browser }) => {
  const db = state();
  for (const capacity of [10, 30]) {
    // Seed a cart selection; edit volume and submit checkout through the actual UI.
    const client = await session(browser, db, 'client', '/', capacity);
    await client.getByRole('button', { name: /Корзина/ }).last().click();
    await client.getByRole('button', { name: 'Изменить вариант доставки для Песок', exact: true }).click();
    await client.getByRole('button').filter({ hasText: options.find(o => o.capacity_m3 === capacity)!.title }).filter({ visible: true }).last().click();
    await client.getByRole('button', { name: 'В корзину', exact: true }).click();
    await client.getByLabel('Объём Песок', { exact: true }).fill('100');
    await client.getByLabel('Объём Песок', { exact: true }).blur();
    await expect(client.getByRole('button', { name: 'Изменить вариант доставки для Песок', exact: true })).toBeVisible();
    await client.getByRole('button', { name: 'Оформить заказ', exact: true }).click();
    await expect.poll(() => db.checkouts.length).toBe(capacity === 10 ? 1 : 2);
    expect(db.checkouts.at(-1)).toMatchObject({ volume: 100, delivery_option_id: `option-${capacity}` });
    await client.context().close();
    const logist = await session(browser, db, 'logist', '/logist/orders');
    const card = logist.locator(`[data-order-id="order-${capacity}"]`);
    await card.getByRole('button', { name: 'Назначить вручную', exact: true }).click();
    await logist.getByText('Выберите водителя...', { exact: true }).click();
    if (capacity === 10) await expect(logist.getByText(driverName, { exact: true })).toBeVisible();
    else { await expect(logist.getByText('Нет водителей', { exact: true })).toBeVisible(); await expect(logist.getByText(driverName, { exact: true })).toHaveCount(0); }
    await logist.context().close();
  }
});
