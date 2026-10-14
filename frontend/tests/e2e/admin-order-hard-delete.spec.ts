import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const id = '11111111-2222-4333-8444-555555555555';
for (const outcome of ['success', 'conflict', 'cancel', 'financial']) {
  test(`admin registry hard delete: ${outcome}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'qa-admin', role: 'admin' }, version: 0 })));
    let deleted = false;
    const mutations: { method: string; path: string }[] = [];
    await page.route('**/api/v1/**', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/\/$/, '');
      if (request.method() !== 'GET' && path.includes('/admin/orders')) {
        mutations.push({ method: request.method(), path });
        if (outcome === 'conflict') return route.fulfill({ status: 409, json: { detail: 'Не удалось полностью удалить заказ из-за связанной записи. Изменения отменены. Обратитесь в поддержку.' } });
        deleted = true;
        return route.fulfill({ json: { ok: true, message: 'Заказ удален навсегда' } });
      }
      let body: unknown = [];
      if (path.endsWith('/cities')) body = [{ id: '22222222-2222-4222-8222-222222222222', code: 'tyumen', name: 'Тюмень', is_active: true, is_default: true }];
      else if (path.endsWith('/admin/orders')) body = deleted ? [] : [{ id, client_name: 'QA hard delete', address: 'QA address', status: 'driver_assigned', is_deleted: false, has_financial_transactions: outcome === 'financial', total_amount: 10, created_at: '2026-10-14T10:00:00Z' }];
      else if (path.endsWith('/payments/config')) body = { enabled: true };
      else if (path.endsWith('/payments')) body = { items: [], quote: null, can_pay: false };
      else if (path.endsWith('/system/version')) body = { android_version: '3.3.6' };
      return route.fulfill({ json: body });
    });
    await page.goto('/admin/orders');
    await expect(page.getByText('QA hard delete', { exact: true })).toBeVisible();
    page.once('dialog', dialog => outcome === 'cancel' ? dialog.dismiss() : dialog.accept());
    await page.getByRole('button', { name: outcome === 'financial' ? 'В архив' : 'Удалить', exact: true }).click();
    if (outcome === 'cancel') {
      expect(mutations).toEqual([]);
      await expect(page.getByText('QA hard delete', { exact: true })).toBeVisible();
    } else {
      await expect.poll(() => mutations.length).toBe(1);
      expect(mutations).toEqual([{ method: 'DELETE', path: `/api/v1/admin/orders/${id}${outcome === 'financial' ? '' : '/hard'}` }]);
      if (outcome === 'success' || outcome === 'financial') {
        await expect(page.getByText(outcome === 'financial' ? 'Заказ перенесён в архив' : 'Заказ удален навсегда', { exact: true })).toBeVisible();
        await expect(page.getByText('QA hard delete', { exact: true })).toHaveCount(0);
      } else {
        await expect(page.getByText(/Изменения отменены/)).toBeVisible();
        await expect(page.getByText('QA hard delete', { exact: true })).toBeVisible();
        await expect(page.getByText('Водитель назначен', { exact: true })).toBeVisible();
      }
    }
  });
}
