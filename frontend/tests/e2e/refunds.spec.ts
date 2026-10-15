import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const paymentId = '40000000-0000-4000-8000-000000000004';
const orderId = '30000000-0000-4000-8000-000000000003';

for (const role of ['admin', 'logist']) {
  for (const width of [390, 1440]) {
    test(`manual partial refund for ${role} at ${width}px keeps idempotency on retry`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(role => localStorage.setItem('auth-storage',
        JSON.stringify({ state: { token: 'refund-qa', role }, version: 0 })), role);
      const payment = { id: paymentId, order_id: orderId, status: 'succeeded', amount: '100.00',
        refundable_amount: '80.00', refunded_amount: '20.00', reserved_refund_amount: '0.00',
        refund_status: 'partial', client_name: 'QA возврат', created_at: '2026-10-14T10:00:00Z',
        events: [], refunds: [], reconciliation_status: 'matched' };
      const submissions: any[] = [];
      let detailRequests = 0;
      await page.route('**/api/v1/**', route => {
        const path = new URL(route.request().url()).pathname;
        let body: unknown = [];
        if (path.endsWith('/refund') && route.request().method() === 'POST') {
          submissions.push(route.request().postDataJSON());
          if (submissions.length === 1) return route.abort('failed');
          payment.refund_status = 'queued'; payment.reserved_refund_amount = '30.00'; payment.refundable_amount = '50.00';
          return route.fulfill({ status: 202, json: { id: 'refund-job', status: 'queued', amount: '30.00' } });
        }
        if (path.endsWith('/cities/')) body = [{ id: orderId, code: 'tyumen', name: 'Тюмень', is_active: true, is_default: true }];
        else if (path.endsWith('/finance/payments')) body = { items: [payment], total: 1 };
        else if (path.endsWith('/finance/summary')) body = { paid: '100', refunded: '20', net: '80', successful_count: 1, failed_count: 0 };
        else if (path.endsWith(`/payments/${paymentId}`)) { detailRequests += 1; body = payment; }
        return route.fulfill({ json: body });
      });
      await page.goto(`/${role}/profile`);
      if (role === 'logist') await page.getByRole('button', { name: 'Профиль', exact: true }).filter({ visible: true }).click();
      await page.getByRole('button', { name: /Финансы Платежи/ }).click();
      await page.getByText('#000003', { exact: true }).filter({ visible: true }).click();
      expect(detailRequests).toBe(1);
      await expect(page.getByText('Доступно к возврату', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Оформить возврат', exact: true }).click();
      await page.getByLabel('Сумма возврата', { exact: true }).fill('30.00');
      await page.getByPlaceholder('Причина возврата').fill('Возврат части доставки');
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Подтвердить возврат', exact: true }).click();
      await expect.poll(() => submissions.length).toBe(1);
      await expect(page.getByRole('button', { name: 'Подтвердить возврат', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Подтвердить возврат', exact: true }).click();
      await expect(page.getByText('Возврат поставлен в очередь', { exact: true })).toBeVisible();
      expect(submissions[0]).toEqual(submissions[1]);
      expect(submissions[0]).toMatchObject({ amount: '30.00', reason: 'Возврат части доставки' });
      expect(submissions[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
      await expect(page.getByRole('button', { name: 'Оформить возврат', exact: true })).toHaveCount(0);
      expect(await page.locator('section.fixed').evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
      await page.screenshot({ path: `test-results/refunds-${role}-${width}.png`, fullPage: true });
    });
  }
}
