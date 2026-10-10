import { describe, expect, it } from "vitest";
import { planRoutineEffects, type RoutineToolDescriptor } from "./routine-effects.js";

function descriptor(
  name: string,
  overrides: Partial<RoutineToolDescriptor> = {},
): RoutineToolDescriptor {
  return { name, viaConnector: true, ...overrides };
}

describe("planRoutineEffects", () => {
  it("plans a read-only tool as a low-risk read", () => {
    expect(planRoutineEffects([descriptor("github_list_repos")])).toEqual([
      { action: "read", target: "github_list_repos", risk: "low" },
    ]);
  });

  it("treats a bare connector provider slug as a possible write", () => {
    expect(planRoutineEffects([descriptor("github")])).toEqual([
      { action: "update", target: "github", risk: "medium" },
    ]);
  });

  it("plans destructive connector verbs at the top tier", () => {
    expect(planRoutineEffects([descriptor("github_delete_repo")])).toEqual([
      { action: "delete", target: "github_delete_repo", risk: "high" },
    ]);
    expect(planRoutineEffects([descriptor("gmail_send_message")])).toEqual([
      { action: "publish", target: "gmail_send_message", risk: "high" },
    ]);
  });

  it("honors a declared write hint even when the name reads", () => {
    expect(planRoutineEffects([descriptor("github_list_repos", { readOnly: false })])).toEqual([
      { action: "update", target: "github_list_repos", risk: "medium" },
    ]);
  });

  it("never lets a read hint relax a mutating name", () => {
    expect(planRoutineEffects([descriptor("github_merge_pr", { readOnly: true })])).toEqual([
      { action: "publish", target: "github_merge_pr", risk: "high" },
    ]);
  });

  it("plans builtin reads as low and builtin deletes as high", () => {
    const effects = planRoutineEffects([
      descriptor("read_file", { viaConnector: false }),
      descriptor("delete_bot", { viaConnector: false }),
    ]);
    expect(effects).toEqual([
      { action: "read", target: "read_file", risk: "low" },
      { action: "delete", target: "delete_bot", risk: "high" },
    ]);
  });

  it("treats an unattended-unsafe builtin like shell as a write", () => {
    expect(planRoutineEffects([descriptor("shell", { viaConnector: false })])).toEqual([
      { action: "update", target: "shell", risk: "medium" },
    ]);
    expect(planRoutineEffects([descriptor("write_file", { viaConnector: false })])).toEqual([
      { action: "update", target: "write_file", risk: "medium" },
    ]);
  });

  it("plans a skill write as a write, because it writes its own future instructions", () => {
    expect(planRoutineEffects([descriptor("skill_create", { viaConnector: false })])).toEqual([
      { action: "update", target: "skill_create", risk: "medium" },
    ]);
    expect(planRoutineEffects([descriptor("skill_delete", { viaConnector: false })])).toEqual([
      { action: "delete", target: "skill_delete", risk: "high" },
    ]);
    expect(planRoutineEffects([descriptor("skill_read", { viaConnector: false })])).toEqual([
      { action: "read", target: "skill_read", risk: "low" },
    ]);
  });

  it("returns no effects for a bot that reaches nothing", () => {
    expect(planRoutineEffects([])).toEqual([]);
  });

  it("collapses duplicate action/target pairs and keeps order", () => {
    const effects = planRoutineEffects([descriptor("github"), descriptor("github")]);
    expect(effects).toHaveLength(1);
  });
});
