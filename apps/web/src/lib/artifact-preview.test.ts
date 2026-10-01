import { describe, expect, it } from "vitest";
import { artifactPreviewIsText, artifactPreviewKind } from "./artifact-preview";

describe("artifactPreviewKind", () => {
  it("maps every attachment type the client can decode", () => {
    expect(artifactPreviewKind("text/markdown")).toBe("markdown");
    expect(artifactPreviewKind("text/html")).toBe("html");
    expect(artifactPreviewKind("application/pdf")).toBe("pdf");
    expect(artifactPreviewKind("image/png")).toBe("image");
    expect(artifactPreviewKind("text/plain")).toBe("text");
    expect(artifactPreviewKind("text/csv")).toBe("text");
    expect(artifactPreviewKind("application/json")).toBe("text");
  });

  it("leaves types without a decoder download-only", () => {
    expect(artifactPreviewKind("application/zip")).toBe("none");
    expect(
      artifactPreviewKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("none");
    expect(artifactPreviewKind("")).toBe("none");
  });
});

describe("artifactPreviewIsText", () => {
  it("is true only for kinds read as UTF-8 text", () => {
    expect(artifactPreviewIsText("markdown")).toBe(true);
    expect(artifactPreviewIsText("text")).toBe(true);
    expect(artifactPreviewIsText("html")).toBe(false);
    expect(artifactPreviewIsText("pdf")).toBe(false);
    expect(artifactPreviewIsText("image")).toBe(false);
    expect(artifactPreviewIsText("none")).toBe(false);
  });
});
