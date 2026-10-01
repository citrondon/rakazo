import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test.describe.configure({ mode: "serial" });

test("agent-attached text files open a readable preview and stay downloadable", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `artifact-card-${stamp}@rakazo.test`, "password12", "Artifact Card");
  await completeOnboarding(page);

  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("write notes/result.txt and attach it to the thread");
  await page.keyboard.press("Enter");

  // Plain text used to be download-only: the whole card was a download button, so reading
  // what the bot wrote meant saving the file and leaving the app for another program.
  const previewButton = page.getByRole("button", { name: "Preview result.txt" });
  await expect(previewButton).toBeVisible({ timeout: 30_000 });
  await captureScreenshot(page, testInfo, "text-file-card");

  await previewButton.click();
  const dialog = page.getByRole("dialog", { name: "result.txt" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("attach it to the thread");
  await captureScreenshot(page, testInfo, "text-preview-open");

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download result.txt" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("result.txt");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(previewButton).toBeFocused();
});

test("agent-attached Markdown opens a rendered preview and can be downloaded", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `markdown-preview-${stamp}@rakazo.test`, "password12", "Markdown Preview");
  await completeOnboarding(page);

  const composer = page.getByPlaceholder(/Message/);
  await composer.fill(
    "write path notes/preview.md and attach it to the thread says # Project preview",
  );
  await page.keyboard.press("Enter");

  const previewButton = page.getByRole("button", { name: "Preview preview.md" });
  await expect(previewButton).toBeVisible({ timeout: 30_000 });
  await captureScreenshot(page, testInfo, "markdown-file-card");
  await previewButton.click();

  const dialog = page.getByRole("dialog", { name: "preview.md" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Project preview" })).toBeVisible();
  const closeButton = dialog.getByRole("button", { name: "Close preview" });
  const downloadButton = dialog.getByRole("button", { name: "Download preview.md" });
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(downloadButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(closeButton).toBeFocused();
  await captureScreenshot(page, testInfo, "markdown-preview-open");

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("preview.md");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(previewButton).toBeFocused();
});
