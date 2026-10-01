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
vi.mock("@rakazo/ui-web", () => ({
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

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TrustPolicySettings", () => {
  it("loads the policy and saves a raised threshold", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    trust.get.mockResolvedValue({ approvalThreshold: "medium", quietHours: null });
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

      expect(trust.set).toHaveBeenCalledWith({ approvalThreshold: "high", quietHours: null });
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
});
