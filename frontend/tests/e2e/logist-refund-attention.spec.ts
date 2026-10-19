import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const city = { id: '0bad7c79-9d2a-4920-a051-71fc22576f16', code: 'tyumen', name: 'Тюмень', is_active: true, is_default: true };
const oldId = '11111111-2222-4333-8444-555555b6a576';
const recentId = '22222222-2222-4333-8444-555555555555';
for (const width of [390, 1440]) {
  for (const fromNotification of [false, true]) {
    test('logist manual refund attention at ' + width + 'px, notification=' + fromNotification, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(cityId => {
        localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'fixture-logist', role: 'logist' }, version: 0 }));
        localStorage.setItem('operator-city', JSON.stringify({ state: { cityId }, version: 0 }));
      }, city.id);
      let resolved = false;
      const requests: string[] = [];
      const old = () => ({ id: oldId, city_id: city.id, created_at: '2020-01-01T10:00:00Z',
        status: 'cancelled', is_deleted: false, payment_status: 'succeeded',
        refundable_amount: resolved ? '0' : '10', requires_manual_refund: !resolved,
        total_amount: 10, delivery_cost: 0, address: 'Тюмень', items: [] });
      const recent = { ...old(), id: recentId, created_at: '2026-10-19T10:00:00Z',
        is_deleted: true, requires_manual_refund: false, refundable_amount: '0', refund_status: 'succeeded' };
      await page.route('**/api/v1/**', route => {
        const url = new URL(route.request().url()), p = url.pathname.replace(/\/$/, '');
        let body: unknown = [];
        if (p.endsWith('/cities')) body = [city];
        else if (p.endsWith('/logist/orders')) {
          requests.push(url.search);
          if (url.searchParams.get('attention_only')) body = resolved ? [] : [old()];
          else if (url.searchParams.get('archive')) body = [recent, old()]; // deliberately reversed
        }
        else if (p.endsWith('/payments/config')) body = { enabled: true };
        else if (p.endsWith('/payments')) body = { items: [], quote: null, can_pay: false };
        else if (p.endsWith('/admin/drivers')) body = [];
        return route.fulfill({ json: body });
      });
      await page.goto('/logist/orders' + (fromNotification ? '?notification_order=' + oldId + '&refund_attention=1' : ''));
      const badge = page.getByLabel('Требуют возврата: 1', { exact: true });
      await expect(badge).toBeVisible();
      await expect(badge).toHaveClass(/bg-red-600/);
      const badgeBox = await badge.boundingBox();
      expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(width);
      if (!fromNotification) await page.getByRole('button', { name: /Архив/ }).click();
      const card = page.locator('[data-order-id="' + oldId + '"]');
      await expect(card.getByText('Требуется ручное решение по возврату средств!', { exact: true })).toBeVisible();
      await expect(card.getByText(/#B6A576/)).toBeVisible();
      await expect(page.locator('[data-order-id]').first()).toHaveAttribute('data-order-id', oldId);
      expect(requests.some(q => q.includes('attention_only=true') && q.includes('city_id=' + city.id))).toBeTruthy();
      const date = page.locator('input[type="date"]');
      if (await date.count()) {
        await date.fill('2026-10-19');
        await expect(card).toBeVisible();
      }
      await page.screenshot({ path: 'test-results/logist-refund-attention-' + width + '-' + fromNotification + '.png', fullPage: true });
      resolved = true;
      await page.getByRole('button', { name: 'Обновить', exact: true }).click();
      await expect(badge).toHaveCount(0);
      await expect(card.getByText('Требуется ручное решение по возврату средств!', { exact: true })).toHaveCount(0);
      await expect(page.locator('[data-order-id]').first()).toHaveAttribute('data-order-id', recentId);
    });
  }
}
