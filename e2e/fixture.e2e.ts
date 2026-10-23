import { test as base, expect } from "@playwright/test";
import { applyMocks, createMockRoutes } from "../src/index.js";
import { API_ORIGIN, openApp, request } from "./app.js";
import mocks from "./mocks/mocks.js";
import client from "./mocks/api/client/GET.json" with { type: "json" };
import application from "./mocks/api/client/application/GET.json" with { type: "json" };

// The fixture recipe from the README
const { mock } = createMockRoutes<keyof typeof mocks>({ mocks, origin: API_ORIGIN });

const defaultMocks = [mock.get("/client"), mock.get("/client/application")];

const test = base.extend({
  page: async ({ page }, use) => {
    await applyMocks(page, defaultMocks);
    await use(page);
  },
});

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("applies the default mocks to every page", async ({ page }) => {
  expect(await request(page, `${API_ORIGIN}/client`)).toEqual({ status: 200, body: client });
  expect(await request(page, `${API_ORIGIN}/client/application`)).toEqual({ status: 200, body: application });
});

test("overrides a default mock in one test", async ({ page }) => {
  await mock.get("/client/application", (data) => ({ ...data, status: "approved" }))(page);

  expect(await request(page, `${API_ORIGIN}/client/application`)).toEqual({
    status: 200,
    body: { ...application, status: "approved" },
  });
});
