import type { BrowserContext, Page, Route } from "@playwright/test";

type Method = "GET" | "POST" | "PUT" | "DELETE";
type Path = `${string}/${Method}`;

/**
 * Extracts the base URL from a path by removing the method suffix
 */
type ExtractBaseUrl<T extends Path> = T extends `${infer U}/${Method}` ? U : never;

/**
 * Maps methods to their allowed paths
 */
type MethodToPath<P extends Path> = {
  [M in Method]: ExtractBaseUrl<Extract<P, `${string}/${M}`>>;
};

/**
 * Function with can be modified the response data.
 */
type ModifierFn<R> = (json: R) => any;

type MockImport = Promise<{ default: any }>;

/**
 * Registers a mock on a page or a browser context.
 * @example
 * ```ts
 * await mock.get('/api/user')(page)
 * await mock.get('/api/user')(context)
 * ```
 */
export type MockRoute = (target: Page | BrowserContext) => Promise<void>;

const createMocksRequest =
  <P extends Path>(options: CreateMockRoutesOptions<P>) =>
  <Res>(method: Method, pathname: string, modifier?: ModifierFn<Res>): MockRoute => {
    const { mocks, debug, origin } = options;
    const getMock = async (route: Route) => {
      const request = route.request();
      // page.route() does not filter by method, so other methods are left to the other routes.
      // Navigations are left alone too, the same way the MSW worker bypasses them.
      if (request.method() !== method || request.isNavigationRequest()) {
        return route.fallback();
      }

      let json: unknown;
      try {
        const mockPath = `${pathname}/${method}` as P;
        const data = await mocks[mockPath].then((res) => res.default);
        if (debug) {
          console.info(`[mocks-to-playwright] Mock file was loaded. [${method}]: "${pathname}"`);
        }
        json = typeof modifier === "function" ? modifier(data) : data;
      } catch (error) {
        if (debug) {
          console.error(`[mocks-to-playwright] Mock file was not found. [${method}]: "${pathname}"`, error);
        }
        return route.fallback();
      }
      return route.fulfill({ json });
    };

    // Construct the URL from the given pathname and domain.
    const url = ((): { origin?: string; pathname: string } => {
      if (origin) {
        try {
          return new URL(pathname, origin);
        } catch (e) {
          if (debug) {
            console.error(
              `[mocks-to-playwright] Invalid URL. The provided option for a createMockRoutes, the URL's origin, has the issue. Values: [origin]: "${origin}" [pathname]: "${pathname}"`,
              e
            );
          }
        }
      }
      // Without an origin any origin matches; the base only normalizes the pathname the way the browser does.
      return { pathname: new URL(pathname, "http://localhost").pathname };
    })();

    // A predicate rather than a glob, because a glob matches the full URL, query string included.
    const matchesUrl = (requestUrl: URL) =>
      requestUrl.pathname === url.pathname && (url.origin === undefined || requestUrl.origin === url.origin);

    return async (target) => {
      await target.route(matchesUrl, getMock);
    };
  };

type MockNamespace<P extends Path> = {
  get: <ResponseType = Record<string, any>>(
    uri: MethodToPath<P>["GET"],
    modifier?: ModifierFn<ResponseType>
  ) => MockRoute;
  post: <ResponseType = Record<string, any>>(
    uri: MethodToPath<P>["POST"],
    modifier?: ModifierFn<ResponseType>
  ) => MockRoute;
  put: <ResponseType = Record<string, any>>(
    uri: MethodToPath<P>["PUT"],
    modifier?: ModifierFn<ResponseType>
  ) => MockRoute;
  delete: <ResponseType = Record<string, any>>(
    uri: MethodToPath<P>["DELETE"],
    modifier?: ModifierFn<ResponseType>
  ) => MockRoute;
};

const createMockNamespace = <P extends Path>(options: CreateMockRoutesOptions<P>): MockNamespace<P> => {
  const mocksRequest = createMocksRequest(options);
  return {
    /**
     * Mocks a GET request to the given URI.
     * @param uri The URI to intercept.
     * @param modifier A function that modifies the response data.
     * @returns A function that registers the mock on a page or a browser context.
     * @example
     * ```ts
     * await mock.get('/api/user')(page)
     * await mock.get('/api/user', (json) => ({ ...json, data: 'modified' }))(page)
     * ```
     */
    get: <ResponseType = Record<string, any>>(uri: MethodToPath<P>["GET"], modifier?: ModifierFn<ResponseType>) =>
      mocksRequest("GET", uri, modifier),
    /**
     * Mocks a POST request to the given URI.
     * @param uri The URI to intercept.
     * @param modifier A function that modifies the response data.
     * @returns A function that registers the mock on a page or a browser context.
     * @example
     * ```ts
     * await mock.post('/api/user')(page)
     * await mock.post('/api/user', (json) => ({ ...json, data: 'modified' }))(page)
     * ```
     */
    post: <ResponseType = Record<string, any>>(uri: MethodToPath<P>["POST"], modifier?: ModifierFn<ResponseType>) =>
      mocksRequest("POST", uri, modifier),
    /**
     * Mocks a PUT request to the given URI.
     * @param uri The URI to intercept.
     * @param modifier A function that modifies the response data.
     * @returns A function that registers the mock on a page or a browser context.
     * @example
     * ```ts
     * await mock.put('/api/user')(page)
     * await mock.put('/api/user', (json) => ({ ...json, data: 'modified' }))(page)
     * ```
     */
    put: <ResponseType = Record<string, any>>(uri: MethodToPath<P>["PUT"], modifier?: ModifierFn<ResponseType>) =>
      mocksRequest("PUT", uri, modifier),
    /**
     * Mocks a DELETE request to the given URI.
     * @param uri The URI to intercept.
     * @param modifier A function that modifies the response data.
     * @returns A function that registers the mock on a page or a browser context.
     * @example
     * ```ts
     * await mock.delete('/api/user')(page)
     * await mock.delete('/api/user', (json) => ({ ...json, data: 'modified' }))(page)
     * ```
     */
    delete: <ResponseType = Record<string, any>>(uri: MethodToPath<P>["DELETE"], modifier?: ModifierFn<ResponseType>) =>
      mocksRequest("DELETE", uri, modifier),
  };
};

interface CreateMockRoutesOptions<Paths extends Path> {
  /**
   * A record of mock imports for each path.
   * @example
   * ```ts
   * const mocks = {
   *   '/api/user/GET': import('./api/user/GET.json', { with: { type: 'json' } }),
   *   '/api/user/POST': import('./api/user/POST.json', { with: { type: 'json' } }),
   * } as const;
   * ```
   */
  mocks: Record<Paths, MockImport>;
  /**
   * A flag to enable debug logs.
   */
  debug?: boolean;
  /**
   * Origin of the URL, that is its scheme, its domain and its port.
   * Without it, requests to any origin are mocked.
   * @example "https://api.example.com"
   */
  origin?: string;
}

/**
 * Creates mock routes for Playwright with the given options.
 * @param options The options to create mock routes.
 * @example
 * ```ts
 * const mocks = {
 *   '/api/user/GET': import('./api/user/GET.json', { with: { type: 'json' } }),
 *   '/api/user/POST': import('./api/user/POST.json', { with: { type: 'json' } }),
 * } as const;
 *
 * const { mock } = createMockRoutes<keyof typeof mocks>({
 *   mocks,
 * });
 * ```
 */
export const createMockRoutes = <P extends Path>(options: CreateMockRoutesOptions<P>) => ({
  /**
   * A namespace to intercept and mock HTTP requests.
   *
   * @example
   * ```ts
   * await mock.get('/api')(page)
   * await mock.post('/api/user', modifier)(context)
   * ```
   */
  mock: createMockNamespace(options),
});

/**
 * Registers several mocks on a page or a browser context, in the given order.
 * Playwright checks the route registered last first, so a later mock wins over an earlier one.
 * @param target The page or the browser context.
 * @param routes The mocks to register.
 * @example
 * ```ts
 * const defaultMocks = [mock.get('/api/user'), mock.get('/api/user/settings')];
 *
 * test.beforeEach(async ({ page }) => {
 *   await applyMocks(page, defaultMocks);
 * });
 * ```
 */
export const applyMocks = async (target: Page | BrowserContext, routes: readonly MockRoute[]) => {
  for (const route of routes) {
    await route(target);
  }
};
