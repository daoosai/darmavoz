/** Live sandbox test. Explicit opt-in; credentials arrive on stdin and are never saved. */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const base = "https://test.darmavoz.ru";
const api = base + "/api/v1";
const folder =
  process.env.DARMAVOZ_PAYMENT_E2E_REPORT_DIR ||
  path.resolve(__dirname, "../../../docs/reports/2026-10-14-yookassa-live");
const progressFile = path.join(folder, "progress.json");
const credentials = JSON.parse(fs.readFileSync(0, "utf8"));
assert.equal(
  process.env.DARMAVOZ_RUN_LIVE_PAYMENTS,
  "1",
  "Explicit sandbox opt-in is required"
);
assert(credentials.secretKey.startsWith("test_"), "Only test keys are allowed");
fs.mkdirSync(folder, { recursive: true });
let report = fs.existsSync(progressFile)
  ? JSON.parse(fs.readFileSync(progressFile, "utf8"))
  : { base, stages: [], errors: [] };
function save(stage, details = {}) {
  Object.assign(report, details);
  if (!report.stages.includes(stage)) report.stages.push(stage);
  fs.writeFileSync(progressFile, JSON.stringify(report, null, 2));
  console.log(stage, JSON.stringify(details));
}
async function responseJson(response) {
  const body = await response.json();
  assert(response.ok(), `HTTP ${response.status()}: ${JSON.stringify(body)}`);
  return body;
}
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  let customer;
  try {
    customer = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    const page = await customer.newPage();
    page.setDefaultTimeout(25000);
    const cities = await responseJson(await page.request.get(api + "/cities/"));
    const city = cities.find((c) => c.code === "tyumen");
    assert(city);
    await page.addInitScript((id) => {
      if (!localStorage.getItem("selected-city"))
        localStorage.setItem(
          "selected-city",
          JSON.stringify({ state: { cityId: id }, version: 1 })
        );
      if (!localStorage.getItem("cart-storage"))
        localStorage.setItem(
          "cart-storage",
          JSON.stringify({
            state: { cartCityId: id, cartItems: [], cityCarts: {} },
            version: 1,
          })
        );
      if (!localStorage.getItem("address-storage"))
        localStorage.setItem(
          "address-storage",
          JSON.stringify({
            state: {
              selectedAddress: "Патрушева, Садовая улица, 3а",
              selectedAddressCoordinates: { lat: 57.091586, lon: 65.533642 },
            },
            version: 0,
          })
        );
    }, city.id);
    await page.goto(base + "/app");
    await page.getByRole("button", { name: "Я Клиент", exact: true }).click();
    await page.getByRole("button", { name: "Профиль", exact: true }).click();
    await page.getByText("Вход / Регистрация", { exact: true }).click();
    await page.locator("input[inputmode=tel]").fill("79999999999");
    await page
      .getByText("Я даю согласие на обработку персональных данных", {
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Получить код", exact: true })
      .click();
    const verified = page.waitForResponse((r) =>
      r.url().includes("/auth/client/verify-code")
    );
    const digits = page.locator('input[maxlength="1"]');
    for (let i = 0; i < 4; i++) await digits.nth(i).fill("0");
    const auth = await responseJson(await verified);
    assert.equal(auth.role, "client");
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("auth-storage") || "{}").state?.role ===
        "client"
    );
    const headers = { Authorization: "Bearer " + auth.access_token };
    save("client_authenticated");
    if (!report.orderId) {
      const points = await responseJson(
        await page.request.get(
          api + "/catalog/pickup-points/global?lat=57.091586&lon=65.533642"
        )
      );
      const point = points.find(
        (p) => p.is_ready && p.material_offers.some((o) => o.price > 0)
      );
      assert(point, "No active point");
      const offer = point.material_offers.find((o) => o.price > 0);
      await page.getByRole("button", { name: "Главная", exact: true }).click();
      await page
        .getByText(offer.material_name, { exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: /Купить с доставкой/ }).click();
      const add = page.getByRole("button", { name: "В корзину", exact: true });
      await add.waitFor();
      if (await add.isDisabled())
        await page.getByRole("button", { name: /м³/ }).first().click();
      await add.click();
      await page
        .getByRole("heading", { name: "Корзина", exact: true })
        .waitFor();
      await page.screenshot({
        path: path.join(folder, "01-cart.png"),
        fullPage: true,
      });
      const checkout = page.waitForResponse(
        (r) =>
          r.url().endsWith("/orders/checkout") &&
          r.request().method() === "POST"
      );
      await page
        .getByRole("button", { name: "Оформить заказ", exact: true })
        .click();
      const order = await responseJson(await checkout);
      save("order_created", {
        orderId: order.id,
        materialAmount: order.total_amount,
        deliveryAmount: order.delivery_cost || 0,
      });
    }
    if (process.env.PAYMENT_E2E_PHASE === "create") return;
    const config = await responseJson(
      await page.request.get(api + "/payments/config", { headers })
    );
    assert.equal(config.enabled, true);
    assert.equal(config.test_mode, true);
    save("sandbox_config_enabled");
    const staff = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      serviceWorkers: "block",
    });
    const login = await responseJson(
      await staff.request.post(api + "/auth/login", {
        form: {
          username: credentials.username,
          password: credentials.password,
        },
      })
    );
    assert.equal(login.role, "logist");
    await staff.addInitScript(
      ({ token, id }) => {
        localStorage.setItem(
          "auth-storage",
          JSON.stringify({ state: { token, role: "logist" }, version: 0 })
        );
        localStorage.setItem(
          "operator-city",
          JSON.stringify({ state: { cityId: id }, version: 0 })
        );
      },
      { token: login.access_token, id: city.id }
    );
    const operator = await staff.newPage();
    operator.setDefaultTimeout(30000);
    await operator.goto(base + "/app");
    const card = operator.locator(`[data-order-id="${report.orderId}"]`);
    await card.waitFor();
    if (!report.stages.includes("price_confirmed")) {
      await card
        .getByRole("button", {
          name: "Подтвердить стоимость для оплаты",
          exact: true,
        })
        .click();
      await card.getByLabel("Материал, ₽").fill("10.00");
      await card.getByLabel("Доставка, ₽").fill("5.00");
      const quote = operator.waitForResponse(
        (r) =>
          r.url().endsWith("/payment-quote") && r.request().method() === "POST"
      );
      await card
        .getByRole("button", { name: "Подтвердить сумму", exact: true })
        .click();
      assert.equal((await responseJson(await quote)).amount, "15.00");
      save("price_confirmed", { paymentAmount: "15.00" });
    }
    await operator.screenshot({
      path: path.join(folder, "02-logist-price-confirmed.png"),
      fullPage: true,
    });
    async function verifyPaidUI() {
      await page.goto(base + "/app?payment_order=" + report.orderId);
      await page.getByText("Оплачено", { exact: true }).last().waitFor();
      await page.screenshot({
        path: path.join(folder, "06-client-paid-desktop.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByText("Оплачено", { exact: true }).last().waitFor();
      await page.screenshot({
        path: path.join(folder, "07-client-paid-mobile.png"),
        fullPage: true,
      });
      await operator.reload();
      await card.getByText("Оплачено", { exact: true }).waitFor();
      await operator.screenshot({
        path: path.join(folder, "08-logist-paid.png"),
        fullPage: true,
      });
      save("client_and_logist_paid_ui_verified");
    }
    const existing = await responseJson(
      await customer.request.get(api + `/orders/${report.orderId}/payments`, {
        headers,
      })
    );
    if (existing.items[0]?.status === "succeeded") {
      assert.equal(existing.items.length, 1);
      assert.equal(existing.can_pay, false);
      await verifyPaidUI();
      await staff.close();
      return;
    }
    await page.goto(base + "/app?payment_order=" + report.orderId);
    const panel = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Оплата заказа", exact: true }),
      })
      .last();
    await panel
      .getByRole("button", { name: /^(Оплатить заказ|Продолжить оплату)$/ })
      .waitFor();
    await panel.getByLabel("Почта для чека").fill("qa-yookassa@example.com");
    await page.screenshot({
      path: path.join(folder, "03-client-pay-button.png"),
      fullPage: true,
    });
    const paymentResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/orders/${report.orderId}/payments`) &&
        r.request().method() === "POST"
    );
    await panel
      .getByRole("button", { name: /^(Оплатить заказ|Продолжить оплату)$/ })
      .click();
    const payment = await responseJson(await paymentResponse);
    assert(payment.confirmation_url, "No provider redirect URL");
    const url = new URL(payment.confirmation_url);
    assert.equal(url.protocol, "https:");
    assert(
      ["yoomoney.ru", "yookassa.ru"].some(
        (h) => url.hostname === h || url.hostname.endsWith("." + h)
      )
    );
    save("payment_link_created", {
      paymentId: payment.payment_id || payment.id,
      providerHost: url.hostname,
    });
    await page.waitForURL((u) => u.hostname !== "test.darmavoz.ru");
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: path.join(folder, "04-yookassa-sandbox.png"),
      fullPage: true,
    });
    const local = await responseJson(
      await customer.request.get(api + `/orders/${report.orderId}/payments`, {
        headers,
      })
    );
    const row = local.items[0];
    assert(row.provider_id);
    report.paymentId = row.id;
    report.providerId = row.provider_id;
    const providerHeaders = {
      Authorization:
        "Basic " +
        Buffer.from(credentials.shopId + ":" + credentials.secretKey).toString(
          "base64"
        ),
    };
    async function providerState() {
      return responseJson(
        await customer.request.get(
          "https://api.yookassa.ru/v3/payments/" + row.provider_id,
          { headers: providerHeaders }
        )
      );
    }
    const actual = await providerState();
    assert.equal(actual.test, true);
    assert.equal(actual.amount.value, "15.00");
    save("provider_test_flag_verified", {
      paymentId: row.id,
      providerId: row.provider_id,
      providerStatus: actual.status,
    });
    if (actual.status !== "succeeded") {
      const fake = await customer.request.post(api + "/webhooks/yookassa", {
        data: {
          type: "notification",
          event: "payment.succeeded",
          object: { id: row.provider_id },
        },
      });
      assert(fake.ok());
      const pending = await responseJson(
        await customer.request.get(api + `/orders/${report.orderId}/payments`, {
          headers,
        })
      );
      assert.notEqual(
        pending.items[0].status,
        "succeeded",
        "Forged webhook must not mark unpaid provider payment as paid"
      );
      save("forged_success_did_not_mark_paid");

      // Continue through the actual sandbox provider UI; inspect selectors before finalising.
      if (process.env.PAYMENT_E2E_PHASE === "link") return;
    }
    if (actual.status !== "succeeded") {
      await page.getByText("Кошелёк", { exact: true }).click();
      await page.waitForTimeout(1800);
      const recurring = page.getByRole("checkbox", {
        name: /Разрешаю автосписания/,
      });
      if (await recurring.count()) await recurring.uncheck();
      await page.screenshot({
        path: path.join(folder, "05-sandbox-wallet.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: /Заплатить/ }).click();
    }
    let settled;
    for (let attempt = 0; attempt < 15; attempt++) {
      settled = await providerState();
      if (settled.status === "succeeded") break;
      await page.waitForTimeout(2000);
    }
    assert.equal(settled.test, true);
    assert.equal(settled.status, "succeeded");
    save("sandbox_payment_succeeded", {
      providerStatus: settled.status,
      providerTest: settled.test,
    });
    const notification = {
      type: "notification",
      event: "payment.succeeded",
      object: { id: row.provider_id },
    };
    for (let i = 0; i < 2; i++)
      assert(
        (
          await customer.request.post(api + "/webhooks/yookassa", {
            data: notification,
          })
        ).ok()
      );
    const paid = await responseJson(
      await customer.request.get(api + `/orders/${report.orderId}/payments`, {
        headers,
      })
    );
    assert.equal(paid.items.length, 1, "Repeat click must reuse one payment");
    assert.equal(paid.items[0].status, "succeeded");
    assert.equal(paid.can_pay, false);
    const events = await responseJson(
      await customer.request.get(api + "/payments/" + row.id, { headers })
    );
    assert.equal(
      events.events.filter((e) => e.type === "payment_succeeded").length,
      1,
      "Repeated webhook must not duplicate success"
    );
    const order = await responseJson(
      await customer.request.get(api + "/orders/" + report.orderId, { headers })
    );
    assert.equal(order.payment_status, "succeeded");
    save("webhook_paid_and_idempotent", {
      localStatus: paid.items[0].status,
      orderPaymentStatus: order.payment_status,
      paymentCount: paid.items.length,
      successEventCount: 1,
    });
    await verifyPaidUI();
    await staff.close();
  } catch (e) {
    if (customer) {
      const pages = customer.pages();
      await pages
        .at(-1)
        ?.screenshot({ path: path.join(folder, "failure.png"), fullPage: true })
        .catch(() => {});
    }
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
