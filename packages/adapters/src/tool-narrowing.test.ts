import { declaredSkillTools } from "@bobbot/core";
import { describe, expect, it } from "vitest";
import {
  MAX_SELECTED_SKILLS,
  planConnectorToolOffer,
  promptTokens,
  selectSkillsForPrompt,
} from "./tool-narrowing.js";

function skillMd(name: string, description: string, tools?: string[]): string {
  const header = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    ...(tools ? [`tools: [${tools.join(", ")}]`] : []),
    "---",
    "",
    `# ${name}`,
  ];
  return `${header.join("\n")}\n`;
}

function skill(name: string, description: string, tools?: string[]) {
  return { name, description, content: skillMd(name, description, tools) };
}

describe("declaredSkillTools", () => {
  it("reads an inline list from a SKILL.md frontmatter", () => {
    expect(
      declaredSkillTools(skillMd("invoices", "Read invoices", ["read_file", "web_fetch"])),
    ).toEqual(["read_file", "web_fetch"]);
  });

  it("reads a block list and a comma-separated string", () => {
    const block = [
      "---",
      "name: invoicing",
      "description: Read invoices",
      "tools:",
      "  - read_file",
      "  - web_fetch",
      "---",
      "",
    ].join("\n");
    expect(declaredSkillTools(block)).toEqual(["read_file", "web_fetch"]);
    expect(
      declaredSkillTools(skillMd("invoicing", "Read invoices", ["read_file, web_fetch"])),
    ).toEqual(["read_file", "web_fetch"]);
  });

  it("declares nothing when the frontmatter is unreadable or the key is missing", () => {
    expect(declaredSkillTools("no frontmatter at all")).toEqual([]);
    expect(declaredSkillTools(skillMd("invoicing", "Read invoices"))).toEqual([]);
  });
});

describe("promptTokens", () => {
  it("drops filler and very short words", () => {
    expect(promptTokens("Please create a chart for the invoices")).toEqual([
      "create",
      "chart",
      "invoices",
    ]);
    expect(promptTokens("Bitte erstelle ein Diagramm für die Rechnungen")).toEqual([
      "diagramm",
      "rechnungen",
    ]);
  });
});

describe("selectSkillsForPrompt", () => {
  const skills = [
    skill("invoice-reader", "Read supplier invoices and file them", ["read_file"]),
    skill("chart-maker", "Draw a chart from a table", ["render_plot"]),
    skill("pdf-shredder", "Split large PDFs into single pages", ["compress_pdf"]),
  ];
  const german = [
    skill("diagramm-bauer", "Ein Diagramm aus einer Tabelle zeichnen", ["render_plot"]),
  ];

  it("picks the skill the prompt names", () => {
    expect(selectSkillsForPrompt("Read the invoice from Acme", skills)).toEqual(["invoice-reader"]);
    expect(selectSkillsForPrompt("Draw a chart for the numbers", skills)).toEqual(["chart-maker"]);
    expect(selectSkillsForPrompt("Bitte ein Diagramm zeichnen", german)).toEqual([
      "diagramm-bauer",
    ]);
  });

  it("matches a compound through the prefix of a name word", () => {
    expect(selectSkillsForPrompt("Mach mir eine Diagrammerstellung", german)).toEqual([
      "diagramm-bauer",
    ]);
  });

  it("needs more than one description word to pick a skill", () => {
    expect(selectSkillsForPrompt("pages", skills)).toEqual([]);
    expect(selectSkillsForPrompt("split large PDFs into single pages", skills)).toEqual([
      "pdf-shredder",
    ]);
  });

  it("returns nothing when the prompt says nothing it knows", () => {
    expect(selectSkillsForPrompt("Plan my holidays", skills)).toEqual([]);
    expect(selectSkillsForPrompt("", skills)).toEqual([]);
  });

  it("caps how many skills one prompt can select", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      skill(`invoice-reader-${index}`, "Read supplier invoices", [`tool_${index}`]),
    );
    expect(selectSkillsForPrompt("Read the invoice", many)).toHaveLength(MAX_SELECTED_SKILLS);
  });
});

describe("planConnectorToolOffer", () => {
  const tools = [
    { name: "read_file" },
    { name: "render_plot" },
    { name: "compress_pdf" },
    { name: "unclaimed_tool" },
  ];

  it("offers everything when no saved skill declares a tool", () => {
    const offer = planConnectorToolOffer({
      tools,
      skills: [skill("chart-maker", "Draw a chart from a table")],
      prompt: "Draw a chart",
    });
    expect(offer.reason).toBe("no-declaration");
    expect(offer.tools).toEqual(tools);
  });

  it("offers everything when no skill matches the prompt", () => {
    const offer = planConnectorToolOffer({
      tools,
      skills: [skill("chart-maker", "Draw a chart from a table", ["render_plot"])],
      prompt: "Plan my holidays",
    });
    expect(offer.reason).toBe("no-skill-matched");
    expect(offer.tools).toEqual(tools);
  });

  it("keeps the matched skill's tools and every tool no skill claims", () => {
    const offer = planConnectorToolOffer({
      tools,
      skills: [
        skill("chart-maker", "Draw a chart from a table", ["render_plot"]),
        skill("pdf-shredder", "Split large PDFs into pages", ["compress_pdf"]),
      ],
      prompt: "Draw a chart of the numbers",
    });
    expect(offer.reason).toBe("narrowed");
    expect(offer.selectedSkills).toEqual(["chart-maker"]);
    expect(offer.tools.map((tool) => tool.name)).toEqual([
      "read_file",
      "render_plot",
      "unclaimed_tool",
    ]);
    expect(offer.droppedTools).toEqual(["compress_pdf"]);
  });

  it("does not narrow when the matched skill's tools are everything already", () => {
    const offer = planConnectorToolOffer({
      tools: [{ name: "render_plot" }],
      skills: [skill("chart-maker", "Draw a chart from a table", ["render_plot"])],
      prompt: "Draw a chart",
    });
    expect(offer.reason).toBe("no-change");
    expect(offer.tools).toEqual([{ name: "render_plot" }]);
  });

  it("offers nothing extra when the run has no connector tools at all", () => {
    const offer = planConnectorToolOffer({
      tools: [],
      skills: [skill("chart-maker", "Draw a chart from a table", ["render_plot"])],
      prompt: "Draw a chart",
    });
    expect(offer.reason).toBe("no-tools");
    expect(offer.tools).toEqual([]);
  });
});
