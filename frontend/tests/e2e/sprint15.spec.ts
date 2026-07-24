import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("admin opens equipment moderation and custom type form", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method || (input instanceof Request ? input.method : "GET");

      if (!url.includes("/api/v1/")) {
        return originalFetch(input, init);
      }

      const pendingListing = {
        id: "listing-1",
        equipment_type: "Автокран",
        equipment_type_name: "Автокран",
        title: "Автокран 25 тонн",
        description: "Требует проверки модератора",
        tariffs: [{ type: "hour", price: 4500, hours: null }],
        city: "Тюмень",
        district: "Центр",
        is_active: true,
        sort_order: 0,
        owner_name: "ООО Поставщик",
        owner_phone: "+79990001122",
        moderation_status: "pending_moderation",
        moderation_comment: null,
        primary_image_url: null,
        media_files: [],
      };

      const body = url.endsWith("/admin/me")
        ? JSON.stringify({ email: "admin@example.test" })
        : url.includes("/admin/equipment-types")
          ? "[]"
          : url.includes("/admin/equipment-applications")
            ? "[]"
            : url.includes("/admin/equipment/listing-1/reject") && method === "POST"
              ? JSON.stringify({ ...pendingListing, moderation_status: "rejected" })
              : url.includes("/admin/equipment")
                ? JSON.stringify([pendingListing])
                : "[]";

      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    window.localStorage.setItem(
      "auth-storage",
      JSON.stringify({
        state: {
          token: "e2e-admin-token",
          role: "admin",
          driverId: null,
          currentUser: null,
        },
        version: 0,
      }),
    );
  });

  await page.goto("/");

  await expect(page.getByText("Панель администратора")).toBeVisible();
  await page.getByRole("button", { name: "Техника" }).click();

  await expect(page.getByRole("heading", { name: "Объявления спецтехники" })).toBeVisible();
  await expect(page.getByRole("button", { name: /На модерации/ })).toBeVisible();
  await page.getByRole("button", { name: /На модерации/ }).click();

  await page.getByRole("button", { name: "Отклонить" }).click();
  await expect(page.getByRole("heading", { name: "Причина отклонения" })).toBeVisible();
  await page.getByLabel("Укажите, что нужно исправить").fill("Не хватает фото");
  await page.getByRole("button", { name: "Отклонить" }).last().click();
  await expect(page.getByRole("heading", { name: "Причина отклонения" })).toHaveCount(0);

  await page.getByRole("button", { name: "Объявления" }).click();
  await page.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByLabel("Тип")).toHaveAttribute("list", "admin-equipment-types");
  await expect(page.getByText(/Не удалось загрузить/)).toHaveCount(0);
});
