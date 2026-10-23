import type { Page } from "@playwright/test";
import { applyMocks, createMockRoutes } from "./index.js";

// Define mock data imports
const mocks = {
  "/api/user/GET": import("./GET.json", { with: { type: "json" } }),
  "/uniq/POST": import("./GET.json", { with: { type: "json" } }),
} as const;

// Create mock routes with type checking
const { mock } = createMockRoutes({
  mocks,
  debug: true,
});

// Define response types
interface User {
  id: string;
  name: string;
  email: string;
}

export const playground = async (page: Page) => {
  // Valid mock calls - these will pass type checking
  await mock.get<User>("/api/user")(page); // OK: matches GET method
  await mock.post("/uniq")(page); // OK: matches POST method

  // Invalid mock calls - these must show type errors
  // @ts-expect-error "/uniq" is only for POST
  mock.get("/uniq");
  // @ts-expect-error "/api/user" is only for GET
  mock.post("/api/user");
  // @ts-expect-error "/api/user" has no PUT mock
  mock.put("/api/user");
  // @ts-expect-error "/unknown" has no mock at all
  mock.get("/unknown");

  // Example with response modifier
  await mock.get<User>("/api/user", (user) => ({
    ...user,
    name: user.name.toUpperCase(),
  }))(page);

  // Several mocks at once, registered in order
  await applyMocks(page, [mock.get("/api/user"), mock.post("/uniq")]);
};
