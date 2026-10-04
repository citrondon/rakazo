// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const bots = vi.hoisted(() => ({
  presets: vi.fn(),
  preset: vi.fn(),
  importPreview: vi.fn(),
  import: vi.fn(),
}));
vi.mock("../lib/rpc", () => ({ rpc: { bots } }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children?: ReactNode }) => children,
    Plural: ({
      value,
      zero,
      one,
      other,
    }: {
      value: number;
      zero?: string;
      one: string;
      other: string;
    }) => (value === 0 ? (zero ?? other) : value === 1 ? one : other).replace("#", String(value)),
  };
});
vi.mock("@rakazo/ui-web", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BotAvatar: ({ identity }: { identity: string }) => <span data-testid={`avatar-${identity}`} />,
    GROK_BOT_COLORS: ["#8B5CF6", "#10B981", "#3B82F6"],
    Button: ({
      children,
      variant: _variant,
      size: _size,
      ...props
    }: { children?: ReactNode; variant?: string; size?: string } & ComponentProps<"button">) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Dialog: Container,
    DialogClose: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    DialogContent: Container,
    DialogDescription: Container,
    DialogHeader: Container,
    DialogTitle: Container,
  };
});

import { BotLibraryOverlay } from "./BotLibraryOverlay";

const manifest = {
  version: 1,
  exportedAt: "2026-01-01T00:00:00.000Z",
  bot: {
    name: "OpenResearch",
    title: "Wissenschafts- & Paper-Rechercheur",
    description: "Recherchiert Quellen und schreibt sie zusammen.",
    instructions: "Du recherchierst und belegst jede Aussage.",
  },
  integrations: ["web-search"],
  boundaries: ["Sendet nie ohne Freigabe.", "Mergt nichts selbst."],
  skills: [],
  memory: [],
  routines: [],
  files: [],
  history: [],
};

const preview = {
  name: "OpenResearch",
  title: "Wissenschafts- & Paper-Rechercheur",
  description: "Recherchiert Quellen und schreibt sie zusammen.",
  instructionsPreview: "Du recherchierst und belegst jede Aussage.",
  boundaries: ["Sendet nie ohne Freigabe.", "Mergt nichts selbst."],
  memoryCount: 2,
  routineNames: [],
  skillNames: [],
  fileCount: 0,
  historyCount: 0,
  warnings: [],
};

const summaries = [
  {
    slug: "openresearch",
    name: "OpenResearch",
    title: "Wissenschafts- & Paper-Rechercheur",
    description: "Recherchiert Quellen und schreibt sie zusammen.",
    integrations: [],
    routineCount: 0,
    memoryCount: 0,
    fileCount: 0,
  },
  {
    slug: "support-desk",
    name: "Support Desk",
    title: "Support-Team",
    description: "Beantwortet Tickets und eskaliert sauber.",
    integrations: [],
    routineCount: 0,
    memoryCount: 0,
    fileCount: 0,
  },
];

function typeSearch(container: HTMLElement, value: string) {
  const input = container.querySelector("[data-testid='bot-library-search']");
  if (!(input instanceof HTMLInputElement)) throw new Error("missing search input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderOverlay() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<BotLibraryOverlay onClose={() => undefined} />));
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function importButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>("[data-testid='bot-library-import']");
}

beforeEach(() => {
  vi.clearAllMocks();
  bots.presets.mockResolvedValue(summaries);
  bots.preset.mockResolvedValue(manifest);
  bots.importPreview.mockResolvedValue(preview);
  bots.import.mockResolvedValue({ name: "OpenResearch" });
});

it("lists the summaries and pulls a preset body only once one is picked", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const overlay = await renderOverlay();
  try {
    expect(overlay.container.textContent).toContain("OpenResearch");
    expect(overlay.container.textContent).toContain("Support Desk");
    expect(overlay.container.querySelector("[data-testid='avatar-openresearch']")).not.toBeNull();
    expect(
      overlay.container.querySelector("[data-testid='bot-category-engineering']"),
    ).not.toBeNull();
    // Nothing but the summary list travelled, so nothing can be imported yet.
    expect(bots.preset).not.toHaveBeenCalled();
    expect(importButton(overlay.container)?.disabled).toBe(true);

    const row = overlay.container.querySelector<HTMLButtonElement>(
      "[data-testid='preset-openresearch']",
    );
    if (!row) throw new Error("missing openresearch row");
    await act(async () => {
      row.click();
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(bots.preset).toHaveBeenCalledWith({ slug: "openresearch" });
      });
    });
    // The memory count only exists in the preview, so it proves the body arrived.
    await act(async () => {
      await vi.waitFor(() => {
        expect(overlay.container.textContent).toContain("2 memories");
      });
    });
    // What the bot will not do, before it exists.
    expect(overlay.container.textContent).toContain("Won't do");
    expect(overlay.container.textContent).toContain("Sendet nie ohne Freigabe.");
    expect(overlay.container.textContent).toContain("Mergt nichts selbst.");
    expect(importButton(overlay.container)?.disabled).toBe(false);
    expect(bots.importPreview).toHaveBeenCalledWith(
      expect.objectContaining({ includeMemory: true, includeFiles: false }),
    );
  } finally {
    await overlay.cleanup();
    vi.unstubAllGlobals();
  }
});

it("narrows the list by description without fetching a preset body", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const overlay = await renderOverlay();
  try {
    await act(async () => {
      typeSearch(overlay.container, "Tickets");
    });
    expect(overlay.container.textContent).toContain("Support Desk");
    expect(overlay.container.textContent).not.toContain("OpenResearch");
    expect(bots.preset).not.toHaveBeenCalled();

    await act(async () => {
      typeSearch(overlay.container, "gibt es nicht");
    });
    expect(overlay.container.textContent).toContain("No bots in this category match your search.");
    expect(bots.preset).not.toHaveBeenCalled();
  } finally {
    await overlay.cleanup();
    vi.unstubAllGlobals();
  }
});

it("imports the picked preset through the shared import path", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const overlay = await renderOverlay();
  try {
    await act(async () => {
      overlay.container
        .querySelector<HTMLButtonElement>("[data-testid='preset-openresearch']")
        ?.click();
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(overlay.container.textContent).toContain("2 memories");
      });
    });
    await act(async () => {
      importButton(overlay.container)?.click();
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(overlay.container.textContent).toContain("was created");
      });
    });

    // Same call the file upload makes, with the flags the picker shows.
    expect(bots.import).toHaveBeenCalledTimes(1);
    const call = bots.import.mock.calls[0];
    if (!call) throw new Error("bots.import was not called");
    const input = call[0];
    expect(input.manifest.bot.name).toBe("OpenResearch");
    expect(input.manifest.integrations).toEqual(["web-search"]);
    expect(input.manifest.boundaries).toEqual([
      "Sendet nie ohne Freigabe.",
      "Mergt nichts selbst.",
    ]);
    expect(input.includeMemory).toBe(true);
    expect(input.includeRoutines).toBe(true);
    expect(input.includeSkills).toBe(true);
    expect(input.includeFiles).toBe(false);
  } finally {
    await overlay.cleanup();
    vi.unstubAllGlobals();
  }
});

it("states no limits for a preset that ships none", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { boundaries: _omitted, ...manifestWithoutBoundaries } = manifest;
  bots.preset.mockResolvedValue(manifestWithoutBoundaries);
  bots.importPreview.mockResolvedValue({ ...preview, boundaries: [] });
  const overlay = await renderOverlay();
  try {
    await act(async () => {
      overlay.container
        .querySelector<HTMLButtonElement>("[data-testid='preset-openresearch']")
        ?.click();
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(overlay.container.textContent).toContain("2 memories");
      });
    });
    expect(overlay.container.textContent).not.toContain("Won't do");
  } finally {
    await overlay.cleanup();
    vi.unstubAllGlobals();
  }
});
