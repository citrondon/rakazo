import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("an expired Composio account stays openable and offers a reconnect", async ({
  page,
}, testInfo) => {
  // A stored-but-expired account: no live Composio key and no real OAuth involved.
  await page.route("**/rpc/connections/list", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            id: "conn-expired",
            connectorId: "composio",
            provider: "gmail",
            displayName: "Gmail",
            status: "revoked",
            capabilities: [],
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    }),
  );
  await page.route("**/rpc/connections/catalog", (route) =>
    route.fulfill({
      json: {
        json: [
          {
            connectorId: "composio",
            slug: "gmail",
            name: "Gmail",
            logo: null,
            connected: false,
            noAuth: false,
          },
        ],
      },
    }),
  );

  await signup(
    page,
    `connection-status-${Date.now()}@rakazo.test`,
    "password12",
    "Connection Status",
  );
  await completeOnboarding(page);

  await page.getByText("Integrations", { exact: true }).click();
  await expect(page.getByPlaceholder("Search apps")).toBeVisible();
  // Only a `revoked` row exists, so the catalog item is not `connected`: the tile must
  // stay openable because it still has accounts.
  await page.getByRole("button", { name: "Gmail" }).click();

  await expect(page.getByTestId("connection-detail")).toBeVisible();
  await expect(page.getByTestId("connection-account-status")).toHaveText("OAuth expired");
  await expect(page.getByRole("button", { name: "Reconnect OAuth", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "connection-expired-reconnect");
});
