import type { Page } from "@playwright/test";

export const APP_ORIGIN = "https://app.test";
export const API_ORIGIN = "https://api.example.test";

/**
 * Opens a fake app page, served by a route instead of a server.
 * Requests that no mock handles get a 404 from a context route, which Playwright checks after
 * all page routes, so the tests never reach the network.
 */
export const openApp = async (page: Page) => {
  await page.context().route("**/*", (route) => route.fulfill({ status: 404, json: { unmocked: true } }));
  await page.route(`${APP_ORIGIN}/`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>App</title>" })
  );
  await page.goto(`${APP_ORIGIN}/`);
};

// The part of RequestInit that can be passed into the page
interface RequestOptions {
  method?: string;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Calls fetch() from the app page and returns the status and the JSON body, or the error.
 */
export const request = (page: Page, url: string, init?: RequestOptions) =>
  page.evaluate(
    async ({ url, init }) => {
      try {
        const response = await fetch(url, init);
        return { status: response.status, body: await response.json() };
      } catch (error) {
        return { error: String(error) };
      }
    },
    { url, init }
  );
