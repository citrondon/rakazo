import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("shows this month's spend and a per-run receipt", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `usage-receipt-${stamp}@rakazo.test`, "password12", "Usage Receipt");
  await completeOnboarding(page);

  // A plain request completes through the scripted runtime and records usage, so the
  // receipt has stored numbers to show without a provider.
  await page.getByPlaceholder(/^Message /).fill("summarize the release notes");
  await page.getByRole("button", { name: "Send" }).click();

  const toggle = page.getByTestId("run-receipt-toggle").last();
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await toggle.click();

  const receipt = page.getByTestId("run-receipt");
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("Tokens");
  await captureScreenshot(page, testInfo, "run-receipt-expanded");

  const settings = await openUserSettings(page, "usage");
  const month = settings.getByTestId("usage-month");
  await expect(month).toBeVisible();
  await expect(month).toContainText("Chief");
  await captureScreenshot(page, testInfo, "usage-this-month");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("user-settings")).toHaveCount(0);

  // The bot's settings panel opens from the bot name in the transcript header; "Show settings"
  // only exists once the panel is already showing the computer.
  await page.locator("main").getByRole("button", { name: "Chief", exact: true }).click();
  const panel = page.getByTestId("side-panel");
  await expect(panel).toHaveAttribute("data-panel", "settings");
  await panel.getByTestId("bot-settings-advanced").locator("summary").click();
  await expect(panel.getByTestId("bot-budget-usage")).toBeVisible();
  await captureScreenshot(page, testInfo, "bot-budget-this-month");
});
