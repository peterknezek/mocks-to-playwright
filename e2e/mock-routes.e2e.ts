import { expect, test } from "@playwright/test";
import { applyMocks, createMockRoutes } from "../src/index.js";
import { API_ORIGIN, APP_ORIGIN, openApp, request } from "./app.js";
import mocks from "./mocks/mocks.js";
import client from "./mocks/api/client/GET.json" with { type: "json" };
import application from "./mocks/api/client/application/GET.json" with { type: "json" };
import submittedApplication from "./mocks/api/client/application/POST.json" with { type: "json" };

const unmocked = { status: 404, body: { unmocked: true } };

test.describe("same origin, without the origin option", () => {
  const { mock } = createMockRoutes<keyof typeof mocks>({ mocks });

  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("fulfills a GET request with the mock", async ({ page }) => {
    await mock.get("/client")(page);

    expect(await request(page, "/client")).toEqual({ status: 200, body: client });
  });

  test("ignores the query string", async ({ page }) => {
    await mock.get("/client")(page);

    expect(await request(page, "/client?page=2&sort=name")).toEqual({ status: 200, body: client });
  });

  test("matches the pathname on any origin", async ({ page }) => {
    await mock.get("/client")(page);

    expect(await request(page, `${API_ORIGIN}/client`)).toEqual({ status: 200, body: client });
  });

  test("does not match other pathnames", async ({ page }) => {
    await mock.get("/client")(page);

    expect(await request(page, "/client/1")).toEqual(unmocked);
    expect(await request(page, "/clients")).toEqual(unmocked);
  });

  test("applies the modifier to the mock", async ({ page }) => {
    await mock.post("/client/application", (data) => ({ ...data, status: "approved" }))(page);

    expect(await request(page, "/client/application", { method: "POST", body: "{}" })).toEqual({
      status: 200,
      body: { ...submittedApplication, status: "approved" },
    });
  });

  test("falls back to the next route when the method differs", async ({ page }) => {
    await mock.get("/client")(page);

    expect(await request(page, "/client", { method: "POST", body: "{}" })).toEqual(unmocked);
  });

  test("serves each method of the same path from its own mock", async ({ page }) => {
    // POST is registered first, so a POST request first reaches the GET route and falls back to it
    await mock.post("/client/application")(page);
    await mock.get("/client/application")(page);

    expect(await request(page, "/client/application")).toEqual({ status: 200, body: application });
    expect(await request(page, "/client/application", { method: "POST", body: "{}" })).toEqual({
      status: 200,
      body: submittedApplication,
    });
  });

  test("lets the mock registered last override an earlier one", async ({ page }) => {
    await applyMocks(page, [mock.get("/client"), mock.get("/client/application")]);
    await mock.get("/client", (data) => ({ ...data, name: "Jane Doe" }))(page);

    expect(await request(page, "/client")).toEqual({ status: 200, body: { ...client, name: "Jane Doe" } });
    expect(await request(page, "/client/application")).toEqual({ status: 200, body: application });
  });

  test("does not mock navigation requests", async ({ page }) => {
    await mock.get("/client")(page);

    const response = await page.goto(`${APP_ORIGIN}/client`);

    expect(response?.status()).toBe(404);
  });

  test("falls back to the next route when the mock fails to load", async ({ page }) => {
    const failing = Promise.reject(new Error("Cannot find module './api/client/GET.json'"));
    // The route handles the rejection later; this only keeps it from being reported as unhandled
    failing.catch(() => {});
    const { mock: failingMock } = createMockRoutes({ mocks: { "/client/GET": failing } });
    await failingMock.get("/client")(page);

    expect(await request(page, "/client")).toEqual(unmocked);
  });
});

test.describe("cross origin, with the origin option", () => {
  const { mock } = createMockRoutes<keyof typeof mocks>({ mocks, origin: API_ORIGIN });

  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  test("fulfills a cross-origin GET request", async ({ page }) => {
    await mock.get("/client")(page);

    const [response, result] = await Promise.all([
      page.waitForResponse(`${API_ORIGIN}/client`),
      request(page, `${API_ORIGIN}/client`),
    ]);

    expect(result).toEqual({ status: 200, body: client });
    // Added by Playwright to fulfilled cross-origin responses, not by mocks-to-playwright
    expect(response.headers()["access-control-allow-origin"]).toBe(APP_ORIGIN);
  });

  test("fulfills a cross-origin POST request with a JSON body, which needs a preflight", async ({ page }) => {
    await mock.post("/client/application")(page);

    const result = await request(page, `${API_ORIGIN}/client/application`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "1" }),
    });

    expect(result).toEqual({ status: 200, body: submittedApplication });
  });

  test("fulfills a cross-origin request with credentials and an authorization header", async ({ page }) => {
    await mock.post("/client/application")(page);

    const result = await request(page, `${API_ORIGIN}/client/application`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", authorization: "Bearer token" },
      body: JSON.stringify({ clientId: "1" }),
    });

    expect(result).toEqual({ status: 200, body: submittedApplication });
  });

  test("control: the browser enforces CORS on fulfilled responses", async ({ page }) => {
    // Playwright keeps an explicit access-control-allow-origin, so this response allows another origin only
    await page.route(`${API_ORIGIN}/client`, (route) =>
      route.fulfill({ json: client, headers: { "access-control-allow-origin": "https://other.test" } })
    );

    expect(await request(page, `${API_ORIGIN}/client`)).toEqual({ error: "TypeError: Failed to fetch" });
  });

  test("does not match the same pathname on another origin", async ({ page }) => {
    await mock.get("/client")(page);

    expect(await request(page, "/client")).toEqual(unmocked);
    expect(await request(page, `${API_ORIGIN}/client`)).toEqual({ status: 200, body: client });
  });
});

test.describe("browser context", () => {
  const { mock } = createMockRoutes<keyof typeof mocks>({ mocks, origin: API_ORIGIN });

  test("fulfills requests of every page in the context", async ({ context, page }) => {
    await openApp(page);
    await mock.get("/client")(context);

    expect(await request(page, `${API_ORIGIN}/client`)).toEqual({ status: 200, body: client });

    const otherPage = await context.newPage();
    await otherPage.route(`${APP_ORIGIN}/`, (route) => route.fulfill({ contentType: "text/html", body: "" }));
    await otherPage.goto(`${APP_ORIGIN}/`);
    expect(await request(otherPage, `${API_ORIGIN}/client`)).toEqual({ status: 200, body: client });
  });

  test("lets a page mock take precedence over a context mock", async ({ context, page }) => {
    await openApp(page);
    await mock.get("/client")(context);
    await mock.get("/client", (data) => ({ ...data, name: "Jane Doe" }))(page);

    expect(await request(page, `${API_ORIGIN}/client`)).toEqual({ status: 200, body: { ...client, name: "Jane Doe" } });
  });
});
