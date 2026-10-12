import { expect, test, type Page } from "@playwright/test";

const cityId = "11111111-1111-4111-8111-111111111111";
const address = "Патрушева, Садовая улица, 3а";
const suggestion = { full_address_name: address, address_name: "Садовая улица, 3а", point: { lat: 57.091586, lon: 65.533642 }, adm_div: [{ type: "settlement", name: "д. Патрушева" }] };
const city = { id: cityId, name: "Тюмень", code: "tyumen", is_active: true, is_default: true, center_lat: 57.15, center_lon: 65.53, map_zoom: 11, min_lat: 57, max_lat: 58, min_lon: 65, max_lon: 66 };

test.use({ serviceWorkers: "block" });

async function setup(page: Page, saveStatus = 201, detail: unknown = undefined) {
  const payloads: Record<string, unknown>[] = [];
  let saved: Record<string, unknown>[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("auth-storage", JSON.stringify({ state: { token: "test-session", role: "client" }, version: 0 }));
  });
  await page.route("https://mapgl.2gis.com/**", route => route.fulfill({ contentType: "application/javascript", body: `window.mapgl={Map:class{constructor(id){this.el=document.getElementById(id)}on(name,cb){if(name==="click")this.el.onclick=()=>cb({lngLat:[65.533642,57.091586]})}off(){}destroy(){}setCenter(){}setZoom(){}},Marker:class{on(){}destroy(){}setCoordinates(){}}};` }));
  await page.route("https://catalog.api.2gis.com/**", route => route.fulfill({ json: { result: { items: [suggestion] } } }));
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/email/verify")) return route.fulfill({ json: { access_token: "fresh-session" } });
    if (path.endsWith("/cities/delivery")) return route.fulfill({ json: city });
    if (path.endsWith("/cities/")) return route.fulfill({ json: [city, { ...city, id: "22222222-2222-4222-8222-222222222222", code: "d-patrusheva", name: "д. Патрушева", center_lat:57.094663, center_lon:65.527353, is_default:false }] });
    if (path.endsWith("/client/addresses")) {
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON();
        payloads.push(payload);
        const restoredSession = saveStatus === 401 && route.request().headers().authorization === "Bearer fresh-session";
        if (saveStatus !== 201 && !restoredSession) return route.fulfill({ status: saveStatus, json: { detail } });
        const item = { ...payload, id: "address-1", client_id: "client-1", is_default: true };
        saved = [item];
        return route.fulfill({ status: 201, json: item });
      }
      return route.fulfill({ json: saved });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Укажите адрес доставки", exact: true }).click();
  await expect(page.getByPlaceholder("Введите адрес...")).toBeVisible();
  return payloads;
}

async function chooseSuggestion(page: Page) {
  await page.getByPlaceholder("Введите адрес...").fill("Патрушева Садовая 3а");
  await page.getByText(address, { exact: true }).click();
}

test("адрес из подсказки сохраняется с полным контрактом и городом", async ({ page }) => {
  const payloads = await setup(page);
  await chooseSuggestion(page);
  await page.getByRole("button", { name: "Сохранить адрес", exact: true }).click();
  await expect(page.getByText("Адрес добавлен!", { exact: true })).toBeVisible();
  expect(payloads[0]).toMatchObject({ full_address: address, city_id: cityId, lat: 57.091586, lon: 65.533642 });
});
