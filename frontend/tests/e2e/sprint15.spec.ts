import { expect, test } from "@playwright/test";

test("admin opens equipment from profile without a loading error", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname.endsWith("/auth/login") && request.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ access_token: "e2e-admin-token", role: "admin" }),
      });
      return;
    }

    if (pathname.endsWith("/admin/me")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ email: "admin@example.test" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Вход для сотрудников" }).click();
  await page.getByLabel("Логин или Телефон").fill("admin");
  await page.getByLabel("Пароль").fill("admin-password");
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page.getByText("Панель администратора")).toBeVisible();
  await page.getByRole("button", { name: "Профиль" }).click();
  await page.getByRole("button", { name: /Спецтехника/ }).click();

  await expect(page.getByRole("heading", { name: "Объявления спецтехники" })).toBeVisible();
  await expect(page.getByText(/Не удалось загрузить/)).toHaveCount(0);
});
