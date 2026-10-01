import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("starts a bot from the shipped library", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `bot-library-${stamp}@rakazo.test`, "password12", "Bot Library");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  // The sidebar keeps the library one click away; the create menu remains an alternate route.
  await page.getByTestId("open-bot-library-direct").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Bot library")).toBeVisible();

  // Search narrows the shipped list to the preset we open.
  await dialog.getByTestId("bot-library-search").fill("OpenResearch");
  const preset = dialog.getByTestId("preset-openresearch");
  await expect(preset).toBeVisible();
  await preset.click();

  // Choosing a preset loads its preview: the copy it brings and the import flags.
  await expect(dialog.getByText("Wissenschafts- & Paper-Rechercheur")).toBeVisible();
  // Anchored so it matches the preview's memory count, never the "Include memories" toggle.
  await expect(dialog.getByText(/^(\d+|No) memories?$/)).toBeVisible();

  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByText(/was created/)).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Done" }).click();

  // The imported bot lands in the sidebar like any other.
  const botList = page.locator("aside").first();
  await expect(botList.getByRole("button", { name: /OpenResearch/ })).toBeVisible();

  await captureScreenshot(page, testInfo, "bot-library-imported");
});
