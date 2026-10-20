import { expect, test } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
const orderId = '11111111-2222-4333-8444-555555b6a576';
const paymentId = '40000000-0000-4000-8000-000000000004';
const city = { id: '0bad7c79-9d2a-4920-a051-71fc22576f16', name: 'Тюмень', code: 'tyumen', is_active: true, is_default: true };
for (const role of ['logist', 'admin']) {
  for (const width of [390, 1440]) {
    test('refund from cancelled order card: ' + role + ' at ' + width, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(({role, cityId}) => {
        localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'refund-fixture', role }, version: 0 }));
        localStorage.setItem('operator-city', JSON.stringify({ state: { cityId }, version: 0 }));
      }, {role, cityId: city.id});
      const order = { id: orderId, city_id: city.id, status: 'cancelled', is_deleted: false,
        total_amount: 10, delivery_cost: 0, created_at: '2026-10-19T10:00:00Z', address: 'Тюмень',
        requires_manual_refund: true, refundable_amount: '10.00', items: [] };
      const payment = { id: paymentId, order_id: orderId, status: 'succeeded', amount: '10.00',
        refundable_amount: '10.00', refunded_amount: '0', reserved_refund_amount: '0' , refund_status: null as string | null };
      const submissions: any[] = [];
      await page.route('**/api/v1/**', route => {
        const url = new URL(route.request().url()), path = url.pathname.replace(/\/$/, '');
        let body: unknown = [];
        if (path.endsWith('/refund') && route.request().method() === 'POST') {
          submissions.push(route.request().postDataJSON());
          if (submissions.length === 1) return route.abort('failed');
          order.refundable_amount = '5.00';
          payment.refundable_amount = '5.00'; payment.reserved_refund_amount = '5.00'; payment.refund_status = 'queued';
          return route.fulfill({ status: 202, json: { id: 'refund-job', status: 'queued' } });
        }
        if (path.endsWith('/cities')) body = [city];
        else if (path.endsWith('/logist/orders') || path.endsWith('/admin/orders')) body = [order];
        else if (path.endsWith('/payments/config')) body = { enabled: true };
        else if (path.endsWith('/orders/' + orderId + '/payments')) body = { items: [payment], quote: {amount: '10.00'}, can_pay: false };
        return route.fulfill({ json: body });
      });
      await page.goto('/' + role + '/orders');
      if (role === 'logist') await page.getByRole('button', { name: /Архив/ }).click();
      const notice = page.getByRole('status').filter({hasText: 'Требуется ручное решение по возврату средств!'});
      const action = notice.getByRole('button', { name: 'Оформить возврат', exact: true });
      await expect(action).toBeVisible();
      await action.click();
      const modal = page.getByRole('dialog', { name: 'Оформить возврат' });
      const amount = modal.getByLabel('Сумма возврата', { exact: true });
      const reason = modal.getByLabel('Причина возврата', { exact: true });
      const submit = modal.getByRole('button', { name: 'Подтвердить возврат', exact: true });
      await expect(amount).toHaveValue('10.00');
      await amount.fill('11');
      await reason.fill('Частичный возврат');
      await modal.getByRole('checkbox').check();
      await submit.click();
      expect(submissions).toHaveLength(0);
      await amount.fill('5.00');
      await reason.fill('');
      await submit.click();
      expect(submissions).toHaveLength(0);
      await reason.fill('   ');
      await submit.click();
      await expect(modal.getByRole('alert')).toContainText('Укажите причину');
      expect(submissions).toHaveLength(0);
      await reason.fill('Возврат с удержанием подачи');
      await page.screenshot({ path: 'test-results/order-refund-modal-' + role + '-' + width + '.png' });
      expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
      await submit.click();
      await expect.poll(() => submissions.length).toBe(1);
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(modal).toHaveCount(0);
      await expect(page.getByText('Возврат поставлен в очередь', { exact: true })).toBeVisible();
      expect(submissions[0]).toEqual(submissions[1]);
      expect(submissions[0]).toMatchObject({ amount: '5.00', reason: 'Возврат с удержанием подачи' });
      expect(submissions[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
      await expect(notice.getByText('Доступно к возврату: 5 ₽', {exact:true})).toBeVisible();
      // A pending refund cannot be duplicated by reopening the modal.
      await notice.getByRole('button', { name: 'Оформить возврат', exact: true }).click();
      await expect(page.getByRole('dialog').getByText(/Нет доступного платежа/)).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Подтвердить возврат' })).toHaveCount(0);
      await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click();
    });
  }
}
