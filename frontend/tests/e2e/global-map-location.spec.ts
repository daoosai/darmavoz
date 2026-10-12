import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

for (const scenario of [
  { name: "гость на ПК", width: 1440, allowed: true },
  { name: "гость на телефоне", width: 390, allowed: true },
  { name: "геолокация запрещена", width: 390, allowed: false },
]) {
  test(`${scenario.name}: карта не ограничена сохранённым населённым пунктом`, async ({ page, context }) => {
    await page.setViewportSize({ width: scenario.width, height: 844 });
    await context.setGeolocation({ latitude: 57.094663, longitude: 65.527353 });
    if (scenario.allowed) await context.grantPermissions(["geolocation"]);
    else await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_success, error) => error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    });
    await page.addInitScript(() => localStorage.setItem("selected-city", JSON.stringify({ state: { cityId: "village" }, version: 1 })));
    await page.route("https://mapgl.2gis.com/**", route => route.fulfill({ contentType: "application/javascript", body: `window.mapgl={Map:class{constructor(el){this.el=el}destroy(){}setCenter(){}setZoom(){}fitBounds(bounds){window.testMapBounds=bounds}},HtmlMarker:class{constructor(map,{html}){this.el=html;map.el.appendChild(html)}destroy(){this.el.remove()}}};` }));
    const requests: URL[] = [];
    await page.route("**/api/v1/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/cities/")) return route.fulfill({ json: [
        { id: "village", code: "village", name: "Патрушева", region: "Тюмень", center_lat: 57.09, center_lon: 65.52, map_zoom: 11, is_active: true },
      ] });
      if (url.pathname.endsWith("/pickup-points/global")) {
        requests.push(url);
        expect(route.request().headers().authorization).toBeUndefined();
        return route.fulfill({ json: [
          { id: "green", name: "Пригородный карьер", short_name: "Карьер", lat: 57.1, lon: 66.06, point_type: "quarry", crm_status: "activated", is_active: true, material_offers: [{ material_id: "sand", material_name: "Песок", price: 180 }] },
          { id: "gray", name: "Серая точка", short_name: "Серая", lat: 57.09, lon: 65.52, point_type: "supplier", crm_status: "registration_completed", is_active: false, material_offers: [] },
        ] });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto("/");
    const client = page.getByRole("button", { name: "Я Клиент", exact: true });
    await expect(client).toBeVisible();
    await client.click();
    await page.getByRole("button", { name: "Карта", exact: true }).click();
    await expect(page.locator(".global-pickup-marker--activated")).toHaveCount(1);
    await expect(page.locator(".global-pickup-marker--inactive")).toHaveCount(1);
    expect(requests.at(-1)?.searchParams.has("city_id")).toBe(false);
    expect(Number(requests.at(-1)?.searchParams.get("lat"))).toBe(scenario.allowed ? 57.094663 : 57.09);
    expect(Number(requests.at(-1)?.searchParams.get("lon"))).toBe(scenario.allowed ? 65.527353 : 65.52);
    await expect(page.locator(".global-user-marker")).toHaveCount(scenario.allowed ? 1 : 0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { testMapBounds?: unknown }).testMapBounds)).toEqual({ southWest: [65.52, 57.09], northEast: [66.06, 57.1] });
    await expect(page.getByPlaceholder("Введите адрес...")).toHaveCount(0);
  });
}
