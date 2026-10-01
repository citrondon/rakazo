// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const triggers = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  previewEffects: vi.fn(),
}));
const events = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../lib/rpc", () => ({ rpc: { triggers, events } }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@rakazo/ui-web", () => ({
  Badge: ({ children, ...props }: ComponentProps<"span">) => <span {...props}>{children}</span>,
  Button: ({ variant: _variant, ...props }: ComponentProps<"button"> & { variant?: string }) => (
    <button {...props} />
  ),
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
  NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
}));

import { ReactiveTriggerSection, triggerSummary } from "./ReactiveTriggerSection";

const catalog = [
  {
    id: "github:issues",
    provider: "github",
    type: "issues",
    source: "connector" as const,
    label: "GitHub issue",
    fields: ["payload.action", "payload.issue.labels"],
  },
];

function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("triggerSummary", () => {
  it("renders the rule against the catalog label", () => {
    const trigger = {
      id: "t1",
      routineId: "r1",
      botId: "b1",
      source: "connector" as const,
      provider: "github",
      eventType: "issues",
      filter: {
        predicates: [
          {
            field: "payload.action",
            operator: "equals" as const,
            value: "opened",
            caseSensitive: false,
          },
        ],
      },
      mappings: [],
      enabled: true,
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:00:00.000Z",
    };
    expect(triggerSummary(trigger, catalog)).toBe("GitHub issue · payload.action equals opened");
  });
});

describe("ReactiveTriggerSection", () => {
  it("lists existing triggers and creates a new one from the catalog", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    triggers.list.mockResolvedValue([]);
    events.list.mockResolvedValue(catalog);
    triggers.create.mockResolvedValue({});
    triggers.remove.mockResolvedValue({ ok: true });
    triggers.previewEffects.mockResolvedValue([
      { action: "update", target: "github", risk: "medium" },
      { action: "delete", target: "github_delete_repo", risk: "high" },
    ]);
    const { container, root } = mount();
    try {
      await act(async () => root.render(<ReactiveTriggerSection routineId="routine-1" />));
      expect(triggers.list).toHaveBeenCalledWith({ routineId: "routine-1" });
      expect(events.list).toHaveBeenCalled();
      expect(triggers.previewEffects).toHaveBeenCalledWith({ routineId: "routine-1" });

      expect(container.textContent).toContain("Planned effects");
      expect(container.textContent).toContain("github · update");
      expect(container.textContent).toContain("high");

      const addToggle = container.querySelector('button[aria-label="Add trigger"]');
      if (!addToggle) throw new Error("missing add toggle");
      await act(async () => (addToggle as HTMLButtonElement).click());

      const select = container.querySelector("select");
      if (!select) throw new Error("missing event select");
      await act(async () => {
        (select as HTMLSelectElement).value = "github:issues";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const submit = [...container.querySelectorAll("button")].find(
        (entry) => entry.textContent === "Add trigger",
      );
      if (!submit) throw new Error("missing submit");
      await act(async () => (submit as HTMLButtonElement).click());

      expect(triggers.create).toHaveBeenCalledWith({
        routineId: "routine-1",
        source: "connector",
        provider: "github",
        eventType: "issues",
        filter: {
          predicates: [
            { field: "payload.action", operator: "equals", value: "", caseSensitive: false },
          ],
        },
        mappings: [],
        enabled: true,
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
