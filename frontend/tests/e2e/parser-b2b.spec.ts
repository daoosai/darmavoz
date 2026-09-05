import { expect, test } from "@playwright/test";

test.use({
  serviceWorkers: "block",
  launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : undefined,
});

test("парсер предлагает оптовые запросы и сохраняет только выбранных кандидатов", async ({ page }) => {
  const requests: { path: string; body: any }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("auth-storage", JSON.stringify({
      state: { token: "e2e-admin-token", role: "admin", driverId: null, currentUser: null }, version: 0,
    }));
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = [];
    if (path.endsWith("/admin/me")) body = { email: "admin@example.test" };
    if (path.endsWith("/admin/placements/summary")) {
      const counts = { trial: 0, active: 0, confirmation_required: 0, hidden: 0, expired: 0, archived: 0 };
      body = {
        active_quarries: 0, active_accumulators: 0, active_equipment: 0,
        totals: counts, by_entity: { quarry: counts, accumulator: counts, equipment: counts },
        policy: { extension_days: 30 },
      };
    }
    if (path.endsWith("/admin/parser/run")) {
      requests.push({ path, body: request.postDataJSON() });
      body = {
        items: ["Оптовая база стройматериалов", "Мобильный карьер"].map((name, index) => ({
          twogis_id: `b2b-${index}`, name, address: "Тюмень, Промышленная, 1",
          lat: 57.15, lon: 65.53, phone: null, is_update: false,
          parsed_data: { rubrics: ["Песок и щебень"] },
        })),
        skipped_items: [{ name: "Строительный двор", reason: "B2C розница / Нецелевая рубрика", count: 10 }],
        truncated: true,
      };
    }
    if (path.endsWith("/admin/parser/save")) {
      requests.push({ path, body: request.postDataJSON() });
      body = { created: 1, updated: 0 };
    }
    await route.fulfill({ json: body });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Точки", exact: true }).first().click();
  const keyword = page.getByLabel("Ключевое слово");
  await expect(keyword).toHaveValue("песок оптом");
  await expect(page.locator("#parser-keywords-material option[value='щебень оптом']")).toHaveCount(1);
  await keyword.fill("Песок  оптом + ПГС");
  await page.getByRole("button", { name: "Запустить", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Результаты парсинга" });
  await expect(dialog).toBeVisible();
  expect(requests[0].body.keyword).toBe("Песок  оптом + ПГС");
  expect(requests[0].body.target).toBe("material");
  await expect(dialog.getByText(/подъезд 30-тонного самосвала/)).toBeVisible();
  await expect(dialog.getByText(/Новые точки сохраняются неактивными/)).toBeVisible();
  await expect(dialog.getByText(/Достигнут лимит выдачи/)).toBeVisible();
  await expect(dialog.getByText(/B2C розница \/ Нецелевая рубрика/)).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Мобильный карьер/ }).uncheck();
  await dialog.getByRole("button", { name: "Добавить выбранные (1)" }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests[1].body.keyword).toBe("Песок  оптом + ПГС");
  expect(requests[1].body.items.map((item: { twogis_id: string }) => item.twogis_id)).toEqual(["b2b-0"]);
});
