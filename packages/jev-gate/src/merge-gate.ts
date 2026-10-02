import { MergeGateInput, MergeGateOutput, GateResult, GateRequirement, GateName } from "@rakazo/contracts";
import { JevAutoReviewProvider } from "@rakazo/adapters";
import type { AutoReviewRequest, AdapterContext } from "@rakazo/adapter-kit";

export class JevMergeGate {
  private jevProvider?: JevAutoReviewProvider;

  constructor(apiKey?: string) {
    if (apiKey) {
      this.jevProvider = new JevAutoReviewProvider({ apiKey });
    }
  }

  async evaluate(input: MergeGateInput): Promise<MergeGateOutput> {
    const results = await Promise.all(
      input.requiredGates.map(gate => this.runGate(gate, input))
    );
    const allRequiredPass = results
      .filter((_, i) => input.requiredGates[i].required)
      .every(r => r.status === "pass");
    return { allowed: allRequiredPass, results };
  }

  private async runGate(gate: GateRequirement, input: MergeGateInput): Promise<GateResult> {
    const base = { name: gate.name, status: "pending" as const, evidence: {} as Record<string, unknown> };
    
    switch (gate.name) {
      case "ci":
        return { ...base, status: await this.checkCI(input.headSha) ? "pass" : "fail", evidence: { sha: input.headSha } };
      case "two-family-review":
        return { ...base, status: await this.checkTwoFamilyReview(input.prNumber) ? "pass" : "fail", evidence: { pr: input.prNumber } };
      case "qa-verdict":
        return { ...base, status: await this.checkQAVerdict(input.headSha) ? "pass" : "fail", evidence: { sha: input.headSha } };
      case "jev-decision":
        return await this.runJevDecision(input);
      default:
        return { ...base, status: "skipped", evidence: { reason: "unknown gate" } };
    }
  }

  private async checkCI(sha: string): Promise<boolean> {
    // Placeholder: integrate with actual CI system (GitHub Actions, GitLab CI, etc.)
    // For now, return true to allow local testing
    return true;
  }

  private async checkTwoFamilyReview(prNumber: number): Promise<boolean> {
    // Placeholder: integrate with GitHub/GitLab review API
    // Check if PR has approvals from two different model families
    return true;
  }

  private async checkQAVerdict(sha: string): Promise<boolean> {
    // Placeholder: integrate with QA system
    return true;
  }

  private async runJevDecision(input: MergeGateInput): Promise<GateResult> {
    const base = { name: "jev-decision" as GateName, status: "pending" as const, evidence: {} as Record<string, unknown> };
    
    if (!this.jevProvider) {
      return { ...base, status: "skipped", evidence: { reason: "Jev API key not configured" } };
    }

    try {
      // Create a mock AutoReviewRequest for the PR merge decision
      const reviewRequest: AutoReviewRequest = {
        toolName: "merge_pr",
        connectorKind: "git",
        args: { prNumber: input.prNumber, headSha: input.headSha, baseSha: input.baseSha },
        userTask: `Decide if PR #${input.prNumber} should be merged based on CI, reviews, and QA results`,
        botDescription: "Merge gate evaluator",
        matchingRules: [],
      };

      const mockContext: AdapterContext = {
        signal: AbortSignal.timeout(30000),
        spaceId: "merge-gate",
        userId: "system",
        operationId: `merge-gate:${input.prNumber}`,
        traceId: `merge-gate:${input.prNumber}`,
      };

      const result = await this.jevProvider.review(reviewRequest, mockContext);
      
      const status = result.decision === "pass" ? "pass" : result.decision === "ask" ? "fail" : "fail";
      
      return {
        ...base,
        status,
        evidence: { 
          decision: result.decision,
          reason: result.reason,
          model: result.model,
        },
        decidedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ...base,
        status: "fail",
        evidence: { error: String(error) },
        decidedAt: new Date().toISOString(),
      };
    }
  }
}

// Factory function for easy instantiation
export function createJevMergeGate(apiKey?: string): JevMergeGate {
  return new JevMergeGate(apiKey);
}