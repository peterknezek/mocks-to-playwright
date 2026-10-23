import { describe, expect, it, vi } from "bun:test";
import type { BrowserContext, Page, Route } from "@playwright/test";
import { applyMocks, createMockRoutes } from "./index.js";

type UrlPredicate = (url: URL) => boolean;
type RouteHandler = (route: Route) => Promise<unknown>;

// Fake page that records the registered routes, the last registered first (as Playwright checks them)
const createFakePage = () => {
  const routes: { predicate: UrlPredicate; handler: RouteHandler }[] = [];
  const route = vi.fn(async (predicate: UrlPredicate, handler: RouteHandler) => {
    routes.unshift({ predicate, handler });
  });
  return { routes, route, page: { route } as unknown as Page };
};

// Fake route for a single request
const createFakeRoute = (url: string, method = "GET", { navigation = false } = {}) => {
  const fulfill = vi.fn(async (_options: { json?: unknown }) => {});
  const fallback = vi.fn(async () => {});
  const route = {
    request: () => ({ url: () => url, method: () => method, isNavigationRequest: () => navigation }),
    fulfill,
    fallback,
  };
  return { fulfill, fallback, route: route as unknown as Route };
};

// Registers a single mock and returns its URL predicate and route handler
const register = async (mockRoute: (target: Page) => Promise<void>) => {
  const { page, routes } = createFakePage();
  await mockRoute(page);
  const [registered] = routes;
  if (!registered) {
    throw new Error("No route was registered");
  }
  return registered;
};

describe("[createMockRoutes] Parts of the module setup", () => {
  it("should return an object with a mock property", () => {
    const mockRoutes = createMockRoutes({
      mocks: {
        "/api/test/GET": Promise.resolve({ default: {} }),
        "/api/test/POST": Promise.resolve({ default: {} }),
      },
    });
    expect(mockRoutes).toHaveProperty("mock");
  });

  it("should return an object with get, post, put and delete methods", () => {
    const { mock } = createMockRoutes({
      mocks: {
        "/api/test/GET": Promise.resolve({ default: {} }),
        "/api/test/POST": Promise.resolve({ default: {} }),
      },
    });
    expect(typeof mock.get).toBe("function");
    expect(typeof mock.post).toBe("function");
    expect(typeof mock.put).toBe("function");
    expect(typeof mock.delete).toBe("function");
  });

  it("should return a function that registers one route on a page", async () => {
    const { mock } = createMockRoutes({
      mocks: { "/api/test/GET": Promise.resolve({ default: {} }) },
    });
    const { page, route } = createFakePage();

    const mockRoute = mock.get("/api/test");
    expect(typeof mockRoute).toBe("function");
    expect(route).not.toHaveBeenCalled();

    await mockRoute(page);
    expect(route).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
  });

  it("should register the route on a browser context", async () => {
    const { mock } = createMockRoutes({
      mocks: { "/api/test/GET": Promise.resolve({ default: {} }) },
    });
    const route = vi.fn(async () => {});

    await mock.get("/api/test")({ route } as unknown as BrowserContext);

    expect(route).toHaveBeenCalledTimes(1);
  });
});

describe("[createMocksRequest] URL matching", () => {
  const mocks = {
    "/api/test/GET": Promise.resolve({ default: {} }),
    "/api/a b/GET": Promise.resolve({ default: {} }),
  };

  it("should match the pathname on any origin when no origin is set", async () => {
    const { mock } = createMockRoutes({ mocks });
    const { predicate } = await register(mock.get("/api/test"));

    expect(predicate(new URL("https://app.test/api/test"))).toBe(true);
    expect(predicate(new URL("https://api.example.com/api/test"))).toBe(true);
    expect(predicate(new URL("https://api.example.com/api/test/1"))).toBe(false);
    expect(predicate(new URL("https://api.example.com/api"))).toBe(false);
  });

  it("should ignore the query string and the hash", async () => {
    const { mock } = createMockRoutes({ mocks });
    const { predicate } = await register(mock.get("/api/test"));

    expect(predicate(new URL("https://app.test/api/test?page=2&sort=name"))).toBe(true);
    expect(predicate(new URL("https://app.test/api/test#top"))).toBe(true);
  });

  it("should compare the pathname the way the browser encodes it", async () => {
    const { mock } = createMockRoutes({ mocks });
    const { predicate } = await register(mock.get("/api/a b"));

    expect(predicate(new URL("https://app.test/api/a%20b"))).toBe(true);
  });

  it("should intercept on specific URI with the setted origin", async () => {
    const { mock } = createMockRoutes({ mocks, origin: "https://api.example.com" });
    const { predicate } = await register(mock.get("/api/test"));

    expect(predicate(new URL("https://api.example.com/api/test"))).toBe(true);
    expect(predicate(new URL("https://api.example.com/api/test?q=1"))).toBe(true);
    expect(predicate(new URL("https://app.test/api/test"))).toBe(false);
    expect(predicate(new URL("http://api.example.com/api/test"))).toBe(false);
    expect(predicate(new URL("https://api.example.com:8443/api/test"))).toBe(false);
  });

  it("should match the pathname only and log an error when the origin is invalid", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { mock } = createMockRoutes({ mocks, origin: "not a url", debug: true });
    const { predicate } = await register(mock.get("/api/test"));

    expect(predicate(new URL("https://app.test/api/test"))).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mocks-to-playwright] Invalid URL. The provided option for a createMockRoutes, the URL\'s origin, has the issue. Values: [origin]: "not a url" [pathname]: "/api/test"',
      expect.any(TypeError)
    );
    consoleErrorSpy.mockRestore();
  });
});

describe("[createMocksRequest] Mocks functionality", () => {
  it("should fulfill the request with the mock data", async () => {
    const mockData = { test: "value" };
    const { mock } = createMockRoutes({
      mocks: { "/api/test/GET": Promise.resolve({ default: mockData }) },
    });
    const { handler } = await register(mock.get("/api/test"));
    const { route, fulfill, fallback } = createFakeRoute("https://app.test/api/test");

    await handler(route);

    expect(fulfill).toHaveBeenCalledWith({ json: mockData });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("should use the mock of the requested method", async () => {
    const { mock } = createMockRoutes({
      mocks: {
        "/api/test/GET": Promise.resolve({ default: { method: "GET" } }),
        "/api/test/POST": Promise.resolve({ default: { method: "POST" } }),
        "/api/test/PUT": Promise.resolve({ default: { method: "PUT" } }),
        "/api/test/DELETE": Promise.resolve({ default: { method: "DELETE" } }),
      },
    });

    for (const [method, mockRoute] of [
      ["GET", mock.get("/api/test")],
      ["POST", mock.post("/api/test")],
      ["PUT", mock.put("/api/test")],
      ["DELETE", mock.delete("/api/test")],
    ] as const) {
      const { handler } = await register(mockRoute);
      const { route, fulfill } = createFakeRoute("https://app.test/api/test", method);
      await handler(route);
      expect(fulfill).toHaveBeenCalledWith({ json: { method } });
    }
  });

  it("should fall back when the request method differs", async () => {
    const { mock } = createMockRoutes({
      mocks: { "/api/test/GET": Promise.resolve({ default: {} }) },
    });
    const { handler } = await register(mock.get("/api/test"));
    const { route, fulfill, fallback } = createFakeRoute("https://app.test/api/test", "POST");

    await handler(route);

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fulfill).not.toHaveBeenCalled();
  });

  it("should fall back for navigation requests", async () => {
    const { mock } = createMockRoutes({
      mocks: { "/api/test/GET": Promise.resolve({ default: {} }) },
    });
    const { handler } = await register(mock.get("/api/test"));
    const { route, fulfill, fallback } = createFakeRoute("https://app.test/api/test", "GET", { navigation: true });

    await handler(route);

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fulfill).not.toHaveBeenCalled();
  });

  it("should call the modifier function with the mock data", async () => {
    const expected = { test: "value" };
    const { mock } = createMockRoutes({
      mocks: { "/api/test/GET": Promise.resolve({ default: expected }) },
    });
    const modifier = vi.fn((data: typeof expected) => ({ ...data, modified: true }));
    const { handler } = await register(mock.get("/api/test", modifier));
    const { route, fulfill } = createFakeRoute("https://app.test/api/test");

    await handler(route);

    expect(modifier).toHaveBeenCalledTimes(1);
    expect(modifier).toHaveBeenCalledWith(expected);
    expect(fulfill).toHaveBeenCalledWith({ json: { test: "value", modified: true } });
  });

  it("should fall back when the mock doesn't exist", async () => {
    const { mock } = createMockRoutes({
      mocks: { "/api/test/GET": Promise.reject(new Error("Test error")) },
    });
    const { handler } = await register(mock.get("/api/test"));
    const { route, fulfill, fallback } = createFakeRoute("https://app.test/api/test");

    await handler(route);

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fulfill).not.toHaveBeenCalled();
  });

  it("should log an info message when debug is true and the mock exists", async () => {
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { mock } = createMockRoutes({
      mocks: { "/api/test/GET": Promise.resolve({ default: {} }) },
      debug: true,
    });
    const { handler } = await register(mock.get("/api/test"));
    await handler(createFakeRoute("https://app.test/api/test").route);

    expect(consoleInfoSpy).toHaveBeenCalledWith('[mocks-to-playwright] Mock file was loaded. [GET]: "/api/test"');
    consoleInfoSpy.mockRestore();
  });

  it("should log an error message when debug is true and the mock doesn't exist", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { mock } = createMockRoutes({
      mocks: { "/api/test/GET": Promise.reject(new Error("Test error")) },
      debug: true,
    });
    const { handler } = await register(mock.get("/api/test"));
    await handler(createFakeRoute("https://app.test/api/test").route);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mocks-to-playwright] Mock file was not found. [GET]: "/api/test"',
      new Error("Test error")
    );
    consoleErrorSpy.mockRestore();
  });

  it("should not log when debug is false", async () => {
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { mock } = createMockRoutes({
      mocks: {
        "/api/test/GET": Promise.resolve({ default: {} }),
        "/api/missing/GET": Promise.reject(new Error("Test error")),
      },
    });
    for (const mockRoute of [mock.get("/api/test"), mock.get("/api/missing")]) {
      const { handler } = await register(mockRoute);
      await handler(createFakeRoute("https://app.test/api/test").route);
    }

    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleInfoSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

describe("[applyMocks] Several mocks at once", () => {
  it("should register the mocks in the given order", async () => {
    const order: string[] = [];
    const routeOf = (name: string) => async () => {
      order.push(name);
    };
    const { page } = createFakePage();

    await applyMocks(page, [routeOf("first"), routeOf("second"), routeOf("third")]);

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("should let a later mock win over an earlier one", async () => {
    const { mock } = createMockRoutes({
      mocks: { "/api/test/GET": Promise.resolve({ default: { name: "default" } }) },
    });
    const { page, routes } = createFakePage();

    await applyMocks(page, [mock.get("/api/test"), mock.get("/api/test", () => ({ name: "override" }))]);

    // Playwright runs the matching routes from the last registered one until one of them handles the request
    const { route, fulfill } = createFakeRoute("https://app.test/api/test");
    const [first] = routes.filter(({ predicate }) => predicate(new URL("https://app.test/api/test")));
    await first?.handler(route);
    expect(fulfill).toHaveBeenCalledWith({ json: { name: "override" } });
  });
});
