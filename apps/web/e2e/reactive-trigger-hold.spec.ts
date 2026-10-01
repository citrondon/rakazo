import { expect, type Page, test } from "@playwright/test";
import type { Routine, Trigger } from "@rakazo/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

/**
 * A quiet window centered on the current UTC minute, so "now" always falls inside it —
 * including the window that wraps past midnight.
 */
function quietWindowAround(now: Date) {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const clock = (value: number) => {
    const wrapped = ((value % 1440) + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
  };
  return { start: clock(minutes - 60), end: clock(minutes + 60), timezone: "UTC" };
}

async function heldRunStatus(page: Page, botId: string) {
  const snapshot = await rpc<{ run?: { status: string } | null }>(page, "threads/get", { botId });
  return snapshot.run?.status ?? null;
}

test("a reactive webhook trigger holds a consequential wake for quiet hours and runs it on approval", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `trigger-hold-${stamp}@rakazo.test`, "password12", "Trigger Hold");
  await completeOnboarding(page);
  const botId = activeBotId(page);

  // A connected tool puts the routine's planned effects at the approval line, so a wake
  // inside quiet hours is held instead of starting unattended work.
  const begun = await rpc<{ connectionId: string }>(page, "connections/begin", {
    provider: "gmail",
    displayName: "Gmail",
  });
  const connection = await rpc<{ status: string }>(page, "connections/complete", {
    connectionId: begun.connectionId,
  });
  expect(connection.status).toBe("connected");
  await rpc(page, "trust/set", {
    approvalThreshold: "medium",
    quietHours: quietWindowAround(new Date()),
  });

  // Build the routine in the editor; saving it reveals the reactive-trigger section below.
  await page.getByTitle("Agent computer").click();
  await page.getByRole("button", { name: "Create Routine" }).click();
  await page.locator("label:has-text('Name') input").fill("Release watch");
  await page
    .locator("label:has-text('Instruction') textarea")
    .fill("remember the release checklist");
  await page.getByRole("button", { name: "Add trigger" }).click();
  await page.getByRole("menuitem", { name: "On a schedule" }).hover();
  await page.getByRole("menuitem", { name: "Every day", exact: true }).click();

  const created = page.waitForResponse(
    (response) => response.url().includes("/rpc/routines/create") && response.ok(),
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await created;

  // A trigger narrows the routine to one inbound event. `payload exists` matches every
  // delivery from the provider without becoming a broad listener.
  const triggers = page.getByTestId("reactive-triggers");
  await expect(triggers).toBeVisible();
  await expect(triggers.getByText("Planned effects")).toBeVisible();
  await expect(triggers.getByText("gmail · update")).toBeVisible();
  await triggers.getByLabel("Add trigger").click();
  await triggers.getByLabel("Event").selectOption("webhook:generic");
  await triggers.getByLabel("Operator").selectOption("exists");
  await triggers
    .getByRole("button", { name: "Add trigger" })
    .filter({ hasText: "Add trigger" })
    .click();
  await expect(triggers.getByText("Inbound webhook · payload")).toBeVisible();
  await captureScreenshot(page, testInfo, "reactive-webhook-trigger");

  const [routine] = await rpc<Routine[]>(page, "routines/list", { botId });
  expect(routine).toMatchObject({ name: "Release watch", active: true, webhookEnabled: true });
  const stored = await rpc<Trigger[]>(page, "triggers/list", { routineId: routine!.id });
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ provider: "webhook", eventType: "generic", enabled: true });

  await page.getByTestId("side-panel").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("side-panel")).toHaveAttribute("data-panel", "closed");

  // Deliver the inbound event the trigger listens for. Inside quiet hours the wake records
  // its paused phase and is held on an ask instead of being scheduled.
  const webhook = await rpc<{ secret: string; path: string }>(page, "bots/rotateWebhookSecret", {
    botId,
  });
  const delivered = await page.request.post(webhook.path, {
    headers: { authorization: `Bearer ${webhook.secret}` },
    data: { event: "generic", source: "release" },
  });
  expect(delivered.ok()).toBeTruthy();

  await expect.poll(() => heldRunStatus(page, botId), { timeout: 30_000 }).toBe("waiting_input");

  const held = page.getByText("Routine paused for quiet hours", { exact: true });
  // The realtime feed can lag the durable run status; reload so the card paints before asserting.
  if ((await held.count()) === 0) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(held).toBeVisible({ timeout: 20_000 });
  // The dry-run plan is one multi-line block, so match it as text rather than by line.
  await expect(page.getByText("Planned effects:", { exact: false })).toBeVisible();
  await expect(page.getByText("medium: gmail · update", { exact: false })).toBeVisible();
  const runNow = page.getByRole("button", { name: "Run now", exact: true });
  await expect(runNow).toBeVisible();
  await captureScreenshot(page, testInfo, "held-dry-run-card");

  // Answering the held card resumes the run through the ordinary answer path.
  await runNow.click();
  await expect(page.getByText("Answered: Run now", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Run now", exact: true })).toHaveCount(0);
  await expect.poll(() => heldRunStatus(page, botId), { timeout: 30_000 }).toBeNull();
  // Answering a choice ask resumes the run with the selected option, so the bot finishes with
  // the same background line and echo the free-text answer path produces.
  await expect(
    page.getByText("on it. i will work this in the background and come back with a result.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("done. i handled: Selected choice run: Run now", { exact: true }),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "held-dry-run-approved");
});
