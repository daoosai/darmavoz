import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const timeline = 'Обычно деньги поступают на карту в течение 10–60 минут. Точный срок зависит от вашего банка (до 3 рабочих дней).';
const orderId = '11111111-2222-4333-8444-555555555555';
const cases = [
  { name: 'partial canceled', orderStatus: 'cancelled', refundStatus: 'partial', refunded: '80.00', reserved: '0', total: 100, retained: '20,00' },
  { name: 'full canceled', orderStatus: 'cancelled', refundStatus: 'succeeded', refunded: '100.00', reserved: '0', total: 100, retained: null },
  { name: 'queued canceled', orderStatus: 'cancelled', refundStatus: 'queued', refunded: '0', reserved: '100', total: 100, retained: null },
  { name: 'partial with pending remainder', orderStatus: 'cancelled', refundStatus: 'pending', refunded: '80', reserved: '20', total: 100, retained: null },
  { name: 'active partial', orderStatus: 'driver_assigned', refundStatus: 'partial', refunded: '80', reserved: '0', total: 100, retained: null },
  { name: 'kopecks', orderStatus: 'cancelled', refundStatus: 'partial', refunded: '80.10', reserved: '0', total: 100.30, retained: '20,20' },
  { name: 'multiple payment attempts', orderStatus: 'cancelled', refundStatus: 'partial', refunded: '60', reserved: '0', total: 100, retained: '20,00', extraRefunded: '20' },
];

for (const width of [390, 1440]) {
  for (const scenario of cases) {
    test('refund information: ' + scenario.name + ' at ' + width + 'px', async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(() => {
        localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'client-refund-fixture', role: 'client' }, version: 0 }));
        localStorage.setItem('selected-city', JSON.stringify({ state: { cityId: 'tyumen' }, version: 1 }));
      });
      await page.route('**/api/v1/**', route => {
        const path = new URL(route.request().url()).pathname.replace(/\/$/, '');
        const payment = { id: 'refund-payment', status: 'succeeded', amount: String(scenario.total),
          refund_status: scenario.refundStatus, refunded_amount: scenario.refunded,
          reserved_refund_amount: scenario.reserved };
        let body: unknown = [];
        if (path.endsWith('/cities')) body = [{ id: 'tyumen', name: 'Тюмень', code: 'tyumen', is_active: true, is_default: true }];
        if (path.endsWith('/clients/me/orders')) body = [{
          id: orderId, status: scenario.orderStatus, total_amount: scenario.total - 10, delivery_cost: 10,
          created_at: '2026-10-16T10:00:00Z', payment_status: 'succeeded',
          items: [{ volume: 10, material: { name: 'Бой кирпича' } }], address: 'Тюмень, Пермякова 9',
        }];
        if (path.endsWith('/payments/config')) body = { enabled: true };
        if (path.endsWith('/orders/' + orderId + '/payments')) body = {
          quote: { amount: String(scenario.total) }, can_pay: false,
          items: [payment, ...(scenario.extraRefunded ? [{ ...payment, id: 'earlier-payment', refunded_amount: scenario.extraRefunded }] : [])],
        };
        return route.fulfill({ json: body });
      });
      await page.goto('/app');
      if (await page.getByRole('button', { name: 'Я Клиент', exact: true }).isVisible())
        await page.getByRole('button', { name: 'Я Клиент', exact: true }).click();
      await page.getByRole('button', { name: 'Заказы', exact: true }).click();
      if (scenario.orderStatus === 'cancelled') await page.getByRole('button', { name: 'История', exact: true }).click();
      const card = page.locator('[data-order-id="' + orderId + '"]');
      const panel = card.getByRole('region', { name: 'Оплата заказа', exact: true });
      await expect(panel.getByText(timeline, { exact: true })).toBeVisible();
      const retention = panel.getByText(/Удержана сумма за подачу транспорта:/);
      if (scenario.retained) {
        await expect(retention).toContainText(scenario.retained);
        await expect(retention).toHaveClass(/text-orange-700/);
      } else await expect(retention).toHaveCount(0);
      expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
      await page.screenshot({ path: 'test-results/client-refund-' + scenario.name.replaceAll(' ', '-') + '-' + width + '.png', fullPage: true });
    });
  }
}

test('terms contain the cancellation and actual transport cost policy in clause 5.3', async ({ page }) => {
  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Пользовательское соглашение', exact: true })).toBeVisible();
  const clause = page.getByText(/^5\.3\. Отмена заказа и возврат средств:/);
  await expect(clause).toContainText('до выезда транспорта на точку погрузки');
  await expect(clause).toContainText('полный возврат средств');
  await expect(clause).toContainText('фактические расходы на подачу транспорта');
});
