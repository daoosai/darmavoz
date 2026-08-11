import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("карта воды показывает изолированные бесплатные и платные точки", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/v1/water-points")) {
        return new Response(JSON.stringify([
          { id: "free-1", water_type: "free", source: "Родник", address: "Тюмень, лесной тракт", lat: 57.15, lon: 65.54, phone: null },
          { id: "paid-1", water_type: "paid", name: "Вода у склада", source: "Скважина", address: "Тюмень, промзона", lat: 57.16, lon: 65.55, phone: "+79990000000", price: 15, price_unit: "литр", description: "Питьевая вода" },
        ]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/v1/catalog/")) {
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  });

  await page.goto("/water");
  await expect(page.getByRole("heading", { name: "Карта воды" })).toBeVisible();
  await expect(page.getByText("Родник")).toBeVisible();
  await expect(page.getByText("Вода у склада")).toBeVisible();
  await expect(page.getByText("Бесплатно")).toBeVisible();
  await expect(page.getByText("15 ₽/литр")).toBeVisible();

  await page.getByRole("button", { name: "Бесплатная" }).click();
  await expect(page.getByText("Родник")).toBeVisible();
  await expect(page.getByText("Вода у склада")).toHaveCount(0);
});
