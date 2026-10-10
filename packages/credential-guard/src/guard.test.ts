import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CredentialGuard } from "./guard.js";

describe("CredentialGuard", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "credential-guard-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("redacts MYAPP_DB_PASSWORD from input", () => {
    const guard = new CredentialGuard();
    const { clean, blocked } = guard.sanitizeInput('run("MYAPP_DB_PASSWORD=secret123")');
    expect(clean).toContain("[REDACTED:MYAPP_DB_PASSWORD]");
    expect(blocked).toBe(true);
  });

  it("redacts AWS keys", () => {
    const guard = new CredentialGuard();
    const { clean } = guard.sanitizeInput("AKIA1234567890ABCDEF");
    expect(clean).toBe("[REDACTED:AWS_KEY]");
  });

  it("redacts GitHub tokens", () => {
    const guard = new CredentialGuard();
    const { clean } = guard.sanitizeInput("ghp_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(clean).toBe("[REDACTED:GH_TOKEN]");
  });

  it("sanitizes transcript output", () => {
    const guard = new CredentialGuard();
    const out = guard.sanitizeOutput('{"stdout": "DB connected with DB_PASSWORD=hunter2"}');
    expect(out).toContain("[REDACTED");
  });

  it("loads custom patterns from constructor", () => {
    const guard = new CredentialGuard([
      { name: "custom", regex: /SECRET_\w+/g, replacement: "[CUSTOM]", severity: "block" },
    ]);
    const { clean, blocked } = guard.sanitizeInput("SECRET_API_KEY=xyz");
    // Both default env-var and custom pattern match - custom replacement wins
    expect(clean).toBe("[REDACTED:[CUSTOM]]");
    expect(blocked).toBe(true);
  });

  it("warn severity does not block", () => {
    const guard = new CredentialGuard([
      { name: "warn-test", regex: /WARN_\w+/g, replacement: "[WARNED]", severity: "warn" },
    ]);
    const { clean, blocked } = guard.sanitizeInput("WARN_SOMETHING=value");
    // Custom pattern replaces first, then default env-var pattern doesn't match modified text
    expect(clean).toBe("[WARNED]=value");
    expect(blocked).toBe(false); // custom is warn severity
  });

  it("finds multiple occurrences", () => {
    const guard = new CredentialGuard();
    const { clean, findings } = guard.sanitizeInput("PASSWORD=hunter22abc TOKEN=abc123def456");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(clean).toContain("[REDACTED");
  });

  it("keeps ordinary code that names a KEY or a TOKEN", () => {
    const guard = new CredentialGuard();
    const source =
      "const KEY = 1.609344;\nTOKEN = tokens.shift();\nconst keys = Object.keys(units);";
    const { clean, blocked, findings } = guard.sanitizeInput(source);
    expect(clean).toBe(source);
    expect(findings).toHaveLength(0);
    expect(blocked).toBe(false);
  });

  it("returns empty findings for clean input", () => {
    const guard = new CredentialGuard();
    const { clean, findings, blocked } = guard.sanitizeInput("hello world");
    expect(clean).toBe("hello world");
    expect(findings).toHaveLength(0);
    expect(blocked).toBe(false);
  });
});
