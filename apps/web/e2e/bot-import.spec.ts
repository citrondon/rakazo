import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

const PRESET = {
  version: 1,
  exportedAt: "2026-01-01T00:00:00.000Z",
  bot: {
    name: "Imported Researcher",
    title: "Research Agent",
    description: "Imported from a preset file.",
    instructions: "You research things carefully and cite sources.",
  },
  memory: [
    {
      path: "guidelines/method.md",
      content: "# Method\n\nAlways check two sources before answering.",
    },
  ],
  routines: [
    {
      name: "Weekly scan",
      prompt: "Summarize new papers.",
      crons: ["0 9 * * 1"],
      timezone: "UTC",
    },
  ],
  files: [{ path: "notes/readme.txt", content: "preset file" }],
  history: [],
};

test("imports a bot preset through the create menu", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `bot-import-${stamp}@rakazo.test`, "password12", "Bot Import");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  // Serve the preset through a download so the test never depends on repo paths.
  const presetDir = join(tmpdir(), `rakazo-import-${stamp}`);
  mkdirSync(presetDir, { recursive: true });
  const presetPath = join(presetDir, "preset.json");
  writeFileSync(presetPath, JSON.stringify(PRESET));

  await page.getByTestId("create-menu-trigger").click();
  await page.getByTestId("import-bot").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Import bot")).toBeVisible();

  // A non-JSON file shows a parse error and keeps the dialog usable.
  const badPath = join(presetDir, "bad.json");
  writeFileSync(badPath, "not json {");
  await dialog.locator("#bot-import-file").setInputFiles(badPath);
  await expect(dialog.getByText(/not valid JSON/i)).toBeVisible();

  // The real preset loads a preview with counts and flags.
  await dialog.locator("#bot-import-file").setInputFiles(presetPath);
  await expect(dialog.getByText("Imported Researcher")).toBeVisible();
  await expect(dialog.getByText(/1 memory/)).toBeVisible();
  await expect(dialog.getByText(/Routines: 1|Routine: 1/)).toBeVisible();
  await expect(dialog.locator('input[type="checkbox"]').first()).toBeChecked();

  // Files import is opt-in and preview stays responsive to flag changes.
  await dialog.getByText("Include files").click();

  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByText(/Bot .+ was created\.|was created/)).toBeVisible({
    timeout: 15_000,
  });
  await dialog.getByRole("button", { name: "Done" }).click();

  // The imported bot appears in the sidebar and opens with a fresh thread.
  const botList = page.locator("aside").first();
  await expect(botList.getByRole("button", { name: /Imported Researcher/ })).toBeVisible();
  await botList
    .getByRole("button", { name: /Imported Researcher/ })
    .first()
    .click();
  await expect(page.getByTestId("transcript")).toContainText("Imported from preset.");

  await captureScreenshot(page, testInfo, "bot-import-completed");
});
