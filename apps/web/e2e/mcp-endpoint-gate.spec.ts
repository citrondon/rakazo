import { expect, type Page, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

/** Open Integrations → the advanced group → MCP servers. */
async function openMcpServers(page: Page) {
  await page.getByText("Integrations", { exact: true }).click();
  await page.getByTestId("integrations-advanced").evaluate((element) => {
    (element as HTMLDetailsElement).open = true;
  });
  await page.getByRole("button", { name: "Manage MCP servers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "MCP servers" })).toBeVisible();
}

async function addServer(page: Page, name: string, endpoint: string) {
  await page.locator("#mcp-name").fill(name);
  await page.locator("#mcp-endpoint").fill(endpoint);
  await page.getByRole("button", { name: "Add server", exact: true }).click();
}

test("a gated URL fails with a short cause, not a stack trace", async ({ page }, testInfo) => {
  await signup(page, `mcp-gate-${Date.now()}@rakazo.test`, "password12", "MCP Gate");
  await completeOnboarding(page);
  await openMcpServers(page);

  // A public host over plain http: the gate answers with the HTTPS rule, or — when the host
  // does not resolve, as .test never does — with the DNS sentence. Never a cause chain.
  await addServer(page, "Gate Probe", "http://mcp.example.test/mcp");

  const alert = page.getByRole("alert");
  // The refusal is the dialog's single <p role="alert">; nothing else on the screen matches it.
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(
    /must use HTTPS|Could not resolve|MCP_ALLOW_PRIVATE_ENDPOINT=true/,
  );
  await expect(alert).not.toContainText(/getaddrinfo|EAI_AGAIN|at Object\.|TypeError/);
  await captureScreenshot(page, testInfo, "mcp-endpoint-gate-refused");
});

test("a non-owner cannot save a private endpoint", async ({ page }, testInfo) => {
  await signup(page, `mcp-gate-private-${Date.now()}@rakazo.test`, "password12", "MCP Private");
  await completeOnboarding(page);
  await openMcpServers(page);

  // Deployment ownership is claimed by the first signup of a deployment and never released,
  // so no e2e order can assume this user holds it. The owner escape is covered without that
  // dependency in apps/api/src/router.test.ts.
  await addServer(page, "Private LAN", "http://10.0.0.8:3927/mcp");

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/must use HTTPS|MCP_ALLOW_PRIVATE_ENDPOINT=true/);
  await expect(page.getByText("Private LAN", { exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "mcp-endpoint-gate-private-refused");
});

test("the add form names the flag before the round trip", async ({ page }, testInfo) => {
  await signup(page, `mcp-gate-notice-${Date.now()}@rakazo.test`, "password12", "MCP Notice");
  await completeOnboarding(page);
  await openMcpServers(page);

  const endpoint = page.locator("#mcp-endpoint");
  await endpoint.fill("http://mcp.example.test/mcp");
  await expect(page.getByText("MCP_ALLOW_PRIVATE_ENDPOINT=true")).toBeVisible();

  // An https URL never carries the extra copy.
  await endpoint.fill("https://mcp.example.test/mcp");
  await expect(page.getByText("MCP_ALLOW_PRIVATE_ENDPOINT=true")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "mcp-endpoint-gate-notice");
});
