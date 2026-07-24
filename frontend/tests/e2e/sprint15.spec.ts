import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("admin opens equipment moderation and custom type form", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("/api/v1/")) {
        return originalFetch(input, init);
      }
      const body = url.endsWith("/admin/me")
        ? JSON.stringify({ email: "admin@example.test" })
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
  await page.getByRole("button", { name: "Техника" }).dispatchEvent("click");

  await expect(page.getByRole("heading", { name: "Объявления спецтехники" })).toBeVisible();
  await expect(page.getByRole("button", { name: /На модерации/ })).toBeVisible();
  await page.getByRole("button", { name: "Добавить" }).dispatchEvent("click");
  await expect(page.getByLabel("Тип")).toHaveAttribute("list", "admin-equipment-types");
  await expect(page.getByText(/Не удалось загрузить/)).toHaveCount(0);
});
