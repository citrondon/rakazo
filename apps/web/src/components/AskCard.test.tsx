import { selectedAskActionLabel } from "@bobbot/core";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${part}${String(values[index] ?? "")}`, ""),
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => `${text}${part}${String(values[index] ?? "")}`, ""),
  }),
}));
vi.mock("@bobbot/chat-ui/web", () => ({
  ChatMarkdown: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@bobbot/ui-web", () => ({
  Button: ({ variant: _variant, ...props }: ComponentProps<"button"> & { variant?: string }) => (
    <button {...props} />
  ),
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

import { AskCard } from "./AskCard";

describe("AskCard", () => {
  it("shows the structured action and risk on an approval card", () => {
    const html = renderToStaticMarkup(
      <AskCard
        block={{
          kind: "ask",
          approvalEffectId: "effect-1",
          effect: { action: "update", target: "destination.write", risk: "medium" },
          text: "Review before writing to notes",
          actions: [
            { id: "allow", label: "Allow once" },
            { id: "deny", label: "Deny" },
          ],
        }}
        canAnswer
        onAnswer={async () => undefined}
      />,
    );

    expect(html).toContain('data-testid="approval-effect-preview"');
    expect(html).toContain("medium: destination.write · update");
    expect(html).toContain("Allow once");
  });
});

describe("selectedAskActionLabel", () => {
  it("maps a choice answer id to its user-facing label", () => {
    expect(
      selectedAskActionLabel("choice-2", [
        { id: "choice-1", label: "Berlin" },
        { id: "choice-2", label: "Seoul" },
      ]),
    ).toBe("Seoul");
  });

  it("falls back to the answer when an action is unavailable", () => {
    expect(selectedAskActionLabel("custom", undefined)).toBe("custom");
  });
});
