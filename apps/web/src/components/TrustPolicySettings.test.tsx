// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const trust = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("../lib/rpc", () => ({ rpc: { trust } }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@bobbot/ui-web", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Label: ({ htmlFor, children, ...props }: ComponentProps<"label">) => (
    <label htmlFor={htmlFor} {...props}>
      {children}
    </label>
  ),
  NativeSelect: (props: ComponentProps<"select">) => <select {...props} />,
  NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
  Switch: ({
    onCheckedChange,
    ...props
  }: ComponentProps<"input"> & { onCheckedChange?: (checked: boolean) => void }) => (
    <input
      type="checkbox"
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}));

import { TrustPolicySettings } from "./TrustPolicySettings";

function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

/** React tracks the input value internally, so drive it through the native setter. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TrustPolicySettings", () => {
  it("loads the policy and saves a raised threshold", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    trust.get.mockResolvedValue({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: null,
      maxToolCallsPerTurnDefault: 10,
    });
    trust.set.mockImplementation(async (next: unknown) => next);
    const { container, root } = mount();
    try {
      await act(async () => root.render(<TrustPolicySettings />));
      expect(trust.get).toHaveBeenCalled();

      const select = container.querySelector("select");
      if (!select) throw new Error("missing threshold select");
      expect((select as HTMLSelectElement).value).toBe("medium");

      await act(async () => {
        (select as HTMLSelectElement).value = "high";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      expect(trust.set).toHaveBeenCalledWith({
        approvalThreshold: "high",
        quietHours: null,
        maxToolCallsPerTurn: null,
        maxToolCallsPerTurnDefault: 10,
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("shows the quiet window fields when the policy has one", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    trust.get.mockResolvedValue({
      approvalThreshold: "medium",
      quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
      maxToolCallsPerTurn: null,
      maxToolCallsPerTurnDefault: 10,
    });
    const { container, root } = mount();
    try {
      await act(async () => root.render(<TrustPolicySettings />));
      const start = container.querySelector('input[aria-label="Quiet hours start"]');
      const end = container.querySelector('input[aria-label="Quiet hours end"]');
      expect((start as HTMLInputElement).value).toBe("22:00");
      expect((end as HTMLInputElement).value).toBe("07:00");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("shows the deployment default while the space inherits it", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    trust.get.mockResolvedValue({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: null,
      maxToolCallsPerTurnDefault: 10,
    });
    const { container, root } = mount();
    try {
      await act(async () => root.render(<TrustPolicySettings />));
      const input = container.querySelector(
        'input[data-testid="max-tool-calls-per-turn"]',
      ) as HTMLInputElement;
      expect(input.value).toBe("");
      expect(input.getAttribute("placeholder")).toBe("10");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("labels an unlimited deployment default as Unlimited", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    trust.get.mockResolvedValue({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: null,
      maxToolCallsPerTurnDefault: 0,
    });
    const { container, root } = mount();
    try {
      await act(async () => root.render(<TrustPolicySettings />));
      const input = container.querySelector(
        'input[data-testid="max-tool-calls-per-turn"]',
      ) as HTMLInputElement;
      expect(input.getAttribute("placeholder")).toBe("Unlimited");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("stores a whole number on blur", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    trust.get.mockResolvedValue({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: null,
      maxToolCallsPerTurnDefault: 10,
    });
    trust.set.mockImplementation(async (next: unknown) => next);
    const { container, root } = mount();
    try {
      await act(async () => root.render(<TrustPolicySettings />));
      const input = container.querySelector(
        'input[data-testid="max-tool-calls-per-turn"]',
      ) as HTMLInputElement;
      await act(async () => {
        typeInto(input, "200");
      });
      await act(async () => {
        input.dispatchEvent(new Event("focusout", { bubbles: true }));
      });
      expect(trust.set).toHaveBeenCalledWith(expect.objectContaining({ maxToolCallsPerTurn: 200 }));
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("stores unlimited when the field is cleared", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    trust.get.mockResolvedValue({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: 200,
      maxToolCallsPerTurnDefault: 10,
    });
    trust.set.mockImplementation(async (next: unknown) => next);
    const { container, root } = mount();
    try {
      await act(async () => root.render(<TrustPolicySettings />));
      const input = container.querySelector(
        'input[data-testid="max-tool-calls-per-turn"]',
      ) as HTMLInputElement;
      await act(async () => {
        typeInto(input, "");
      });
      await act(async () => {
        input.dispatchEvent(new Event("focusout", { bubbles: true }));
      });
      expect(trust.set).toHaveBeenCalledWith(expect.objectContaining({ maxToolCallsPerTurn: 0 }));
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("keeps the previous value and reports an invalid entry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    trust.get.mockResolvedValue({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: null,
      maxToolCallsPerTurnDefault: 10,
    });
    const { container, root } = mount();
    try {
      await act(async () => root.render(<TrustPolicySettings />));
      const input = container.querySelector(
        'input[data-testid="max-tool-calls-per-turn"]',
      ) as HTMLInputElement;
      await act(async () => {
        typeInto(input, "2.5");
      });
      await act(async () => {
        input.dispatchEvent(new Event("focusout", { bubbles: true }));
      });
      expect(trust.set).not.toHaveBeenCalled();
      expect(container.textContent).toContain("Enter a whole number of tool calls");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("leaves the fuse alone when the empty inherited field is untouched", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    trust.get.mockResolvedValue({
      approvalThreshold: "medium",
      quietHours: null,
      maxToolCallsPerTurn: null,
      maxToolCallsPerTurnDefault: 10,
    });
    const { container, root } = mount();
    try {
      await act(async () => root.render(<TrustPolicySettings />));
      const input = container.querySelector(
        'input[data-testid="max-tool-calls-per-turn"]',
      ) as HTMLInputElement;
      await act(async () => {
        input.dispatchEvent(new Event("focusin", { bubbles: true }));
      });
      await act(async () => {
        input.dispatchEvent(new Event("focusout", { bubbles: true }));
      });
      expect(trust.set).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
