interface SecretPattern {
  name: string;
  regex: RegExp;
  replacement: string;
  severity: "warn" | "block";
}

interface Finding {
  pattern: string;
  count: number;
  severity: "warn" | "block";
}

interface SanitizeResult {
  clean: string;
  blocked: boolean;
  findings: Finding[];
}

const DEFAULT_PATTERNS: SecretPattern[] = [
  {
    name: "env-var",
    regex: /([A-Z_]+_(PASSWORD|SECRET|TOKEN|KEY))=([^\s"'&]+)/gi,
    replacement: "[REDACTED:$1]",
    severity: "block",
  },
  {
    name: "env-var-lower",
    regex: /\b(PASSWORD|SECRET|TOKEN|KEY)\s*=\s*([^\s"'&]+)/gi,
    replacement: "[REDACTED:$1]",
    severity: "block",
  },
  {
    name: "aws-key",
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: "[REDACTED:AWS_KEY]",
    severity: "block",
  },
  {
    name: "github-token",
    regex: /gh[psou]_[a-zA-Z0-9]{36}/g,
    replacement: "[REDACTED:GH_TOKEN]",
    severity: "block",
  },
  {
    name: "private-key",
    regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    replacement: "[REDACTED:PRIVATE_KEY]",
    severity: "block",
  },
];

export class CredentialGuard {
  private patterns: SecretPattern[];

  constructor(customPatterns?: SecretPattern[]) {
    this.patterns = customPatterns ? [...DEFAULT_PATTERNS, ...customPatterns] : DEFAULT_PATTERNS;
  }

  sanitizeInput(input: string): SanitizeResult {
    const findings: Finding[] = [];
    let clean = input;
    let blocked = false;

    for (const p of this.patterns) {
      const matches = [...input.matchAll(p.regex)];
      if (matches.length) {
        findings.push({ pattern: p.name, count: matches.length, severity: p.severity });
        clean = clean.replace(p.regex, p.replacement);
        if (p.severity === "block") blocked = true;
      }
    }

    return { clean, blocked, findings };
  }

  sanitizeOutput(output: string): string {
    return this.sanitizeInput(output).clean;
  }

  getPatterns(): SecretPattern[] {
    return this.patterns;
  }
}
