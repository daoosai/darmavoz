import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const driverId = '20000000-0000-4000-8000-000000000001';
const vehicleId = '30000000-0000-4000-8000-000000000001';
const categoryId = '40000000-0000-4000-8000-000000000001';
const vehicle = {
  id: vehicleId, brand: 'КАМАЗ', plate_number: 'А123АА72', vehicle_type: 'Самосвал',
  cubature_min: 10, cubature_max: 14, tonnage_min: 8, tonnage_max: 12,
  transport_category_id: null, delivery_option_id: null, moderation_status: 'incomplete', is_active: true,
};

for (const hasVehicle of [true, false]) {
  test(hasVehicle ? 'логист проверяет машину из регистрации без повторного ввода' : 'водитель без машины получает пустую форму', async ({ page }) => {
    const driver = { id: driverId, name: 'Водитель частник', phone: '+79990000001', city_ids: [],
      status: 'offline', is_active: true, moderation_status: 'incomplete',
      vehicle_id: hasVehicle ? vehicleId : null, vehicle: hasVehicle ? vehicle : null };
    await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'qa-only', role: 'logist' }, version: 0 })));
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = [];
      if (path.endsWith('/admin/drivers')) body = [driver];
      else if (path.endsWith(`/admin/drivers/${driverId}`)) body = driver;
      else if (path.endsWith(`/drivers/${driverId}/vehicles`)) body = hasVehicle ? [vehicle] : [];
      else if (path.endsWith(`/drivers/${driverId}/vehicle`)) body = driver;
      else if (path.endsWith('/catalog/transport-categories')) body = [{ id: categoryId, title: 'Самосвалы' }];
      else if (path.endsWith('/admin/me')) body = { email: 'qa@example.invalid' };
      await route.fulfill({ json: body });
    });
    await page.goto('/logist/orders');
    await page.getByRole('button', { name: 'Водители', exact: true }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'Назначить машину', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Транспорт водителя' });
    await expect(dialog.getByLabel('Машина', { exact: true })).toHaveValue(hasVehicle ? vehicleId : '');
    await expect(dialog.getByLabel('Марка машины', { exact: true })).toHaveValue(hasVehicle ? 'КАМАЗ' : '');
    await expect(dialog.getByLabel('Госномер', { exact: true })).toHaveValue(hasVehicle ? 'А123АА72' : '');
    await expect(dialog.getByLabel('Тип машины', { exact: true })).toHaveValue(hasVehicle ? 'Самосвал' : '');
    for (const [label, value] of [['Кубатура от, м³', '10'], ['Кубатура до, м³', '14'], ['Тоннаж от, т', '8'], ['Тоннаж до, т', '12']]) {
      await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(hasVehicle ? value : '');
    }
    if (!hasVehicle) return;
    await dialog.getByLabel('Категория транспорта', { exact: true }).selectOption(categoryId);
    const saved = page.waitForRequest(request => request.method() === 'PATCH' && request.url().endsWith(`/drivers/${driverId}/vehicle`));
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect((await saved).postDataJSON()).toMatchObject({ vehicle_id: vehicleId, create_new_vehicle: false,
      vehicle_brand: 'КАМАЗ', vehicle_plate_number: 'А123АА72', vehicle_type: 'Самосвал',
      cubature_min: 10, cubature_max: 14, tonnage_min: 8, tonnage_max: 12, transport_category_id: categoryId });
    await expect(dialog).toHaveCount(0);
  });
}
