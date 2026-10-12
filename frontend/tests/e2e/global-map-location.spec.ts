import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

for (const scenario of [
  { name: "гость на ПК", width: 1440, allowed: true, selected: false, coordinates: true },
  { name: "гость на телефоне", width: 390, allowed: true, selected: false, coordinates: true },
  { name: "геолокация запрещена", width: 390, allowed: false, selected: false, coordinates: true },
  { name: "выбранный адрес имеет приоритет перед GPS", width: 390, allowed: true, selected: true, coordinates: true },
  { name: "выбранный адрес без координат геокодируется без GPS", width: 1440, allowed: true, selected: true, coordinates: false },
]) {
  test(`${scenario.name}: карта не ограничена сохранённым населённым пунктом`, async ({ page, context }) => {
    await page.setViewportSize({ width: scenario.width, height: 844 });
    await context.setGeolocation({ latitude: 57.094663, longitude: 65.527353 });
    if (scenario.allowed) await context.grantPermissions(["geolocation"]);
    else await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_success, error) => error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    });
    if (scenario.selected) await page.addInitScript(withCoordinates => {
      localStorage.setItem("cart-storage", JSON.stringify({state:{cartCityId:"village",cartItems:[],cityCarts:{}},version:1}));
      localStorage.setItem("address-storage", JSON.stringify({state:{selectedAddress:"Патрушева, Садовая улица, 3а",selectedAddressCoordinates:withCoordinates?{lat:57.094663,lon:65.527353}:null},version:0}));
      (window as unknown as { gpsCalls: number }).gpsCalls=0;
      navigator.geolocation.getCurrentPosition=()=>{(window as unknown as { gpsCalls:number }).gpsCalls+=1;};
    }, scenario.coordinates);
    await page.addInitScript(() => localStorage.setItem("selected-city", JSON.stringify({ state: { cityId: "village" }, version: 1 })));
    await page.route("https://mapgl.2gis.com/**", route => route.fulfill({ contentType: "application/javascript", body: `window.mapgl={Map:class{constructor(el){this.el=el}destroy(){}setCenter(point){window.testMapCenter=point}setZoom(){}fitBounds(bounds){window.testMapBounds=bounds}},HtmlMarker:class{constructor(map,{html,zIndex}){this.el=html;html.style.position="absolute";html.style.left="50%";html.style.top=html.className==="global-user-marker"?"300px":"400px";html.style.zIndex=String(zIndex??0);map.el.appendChild(html)}destroy(){this.el.remove()}}};` }));
    const requests: URL[] = [];
    await page.route("**/api/v1/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/cities/")) return route.fulfill({ json: [
        { id: "village", code: "village", name: "Патрушева", region: "Тюмень", center_lat: 57.09, center_lon: 65.52, map_zoom: 11, is_active: true },
      ] });
      if (url.pathname.endsWith("/geo/geocode")) return route.fulfill({json:{lat:57.094663,lon:65.527353}});
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
    await expect(client).toBeVisible({timeout:15000});
    await client.click();
    await page.getByRole("button", { name: "Карта", exact: true }).click();
    await expect(page.locator(".global-pickup-marker--activated")).toHaveCount(1);
    await expect(page.locator(".global-pickup-marker--inactive")).toHaveCount(1);
    const green = page.locator(".global-pickup-marker--activated");
    expect(await green.evaluate(el => { const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })).toBe(true);
    expect(requests.at(-1)?.searchParams.has("city_id")).toBe(false);
    expect(Number(requests.at(-1)?.searchParams.get("lat"))).toBe(scenario.allowed ? 57.094663 : 57.09);
    expect(Number(requests.at(-1)?.searchParams.get("lon"))).toBe(scenario.allowed ? 65.527353 : 65.52);
    await expect(page.locator(".global-user-marker")).toHaveCount(scenario.allowed && !scenario.selected ? 1 : 0);
    if (scenario.selected) {
      await expect.poll(() => page.evaluate(() => (window as unknown as { testMapCenter?: unknown }).testMapCenter)).toEqual([65.527353,57.094663]);
      await page.getByRole("button",{name:"Адрес доставки",exact:true}).click();
      expect(await page.evaluate(()=>(window as unknown as {gpsCalls:number}).gpsCalls)).toBe(0);
    } else {
      await expect.poll(() => page.evaluate(() => (window as unknown as { testMapBounds?: unknown }).testMapBounds)).toEqual({ southWest: [65.52, 57.09], northEast: [66.06, 57.1] });
    }
    await expect(page.getByPlaceholder("Введите адрес...")).toHaveCount(0);
  });
}
