import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, rpc, signup } from "./helpers";

type TrustView = { maxToolCallsPerTurn: number | null; maxToolCallsPerTurnDefault: number };

test("sets the per-space tool-call limit from settings", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(
    page,
    `agent-limits-${stamp}@rakazo.test`,
    "password12",
    `Agent limits ${stamp}`,
    testInfo,
  );
  await completeOnboarding(page, testInfo);

  const settings = await openUserSettings(page);
  await settings.getByTestId("advanced-settings").locator("summary").click();
  const field = settings.getByTestId("max-tool-calls-per-turn");
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("");

  // The placeholder names the fuse that applies while the space stores nothing.
  const initial = await rpc<TrustView>(page, "trust/get", {});
  await expect(field).toHaveAttribute(
    "placeholder",
    initial.maxToolCallsPerTurnDefault === 0
      ? "Unlimited"
      : String(initial.maxToolCallsPerTurnDefault),
  );

  // Dirty-check: focusing and leaving the empty inherited field must not write 0 (unlimited).
  await field.focus();
  await field.blur();
  expect((await rpc<TrustView>(page, "trust/get", {})).maxToolCallsPerTurn).toBeNull();

  await captureScreenshot(page, testInfo, "agent-limits-inherited");

  await field.fill("200");
  await field.blur();
  await expect
    .poll(async () => (await rpc<TrustView>(page, "trust/get", {})).maxToolCallsPerTurn)
    .toBe(200);
  await captureScreenshot(page, testInfo, "agent-limits-200");

  // A reload proves the value came back from the server, not from component state.
  await page.reload();
  const reopened = await openUserSettings(page);
  await reopened.getByTestId("advanced-settings").locator("summary").click();
  await expect(reopened.getByTestId("max-tool-calls-per-turn")).toHaveValue("200");

  // Clearing the field stores unlimited.
  const cleared = reopened.getByTestId("max-tool-calls-per-turn");
  await cleared.fill("");
  await cleared.blur();
  await expect
    .poll(async () => (await rpc<TrustView>(page, "trust/get", {})).maxToolCallsPerTurn)
    .toBe(0);
});
