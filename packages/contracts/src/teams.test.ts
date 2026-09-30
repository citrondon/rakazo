import { describe, expect, it } from "vitest";
import { TeamCreateInputSchema, TeamCreateOutputSchema } from "./index.js";

describe("team start contract", () => {
  it("takes a roster by template id or by identity", () => {
    expect(TeamCreateInputSchema.parse({ templateId: "eng" })).toEqual({
      templateId: "eng",
    });
    expect(TeamCreateInputSchema.parse({ identityId: "engineer", name: "My team" })).toEqual({
      identityId: "engineer",
      name: "My team",
    });
  });

  // An identity already stands for one team, so naming both leaves the server
  // guessing which list the user actually picked from.
  it("refuses a request that names both or neither", () => {
    expect(TeamCreateInputSchema.safeParse({}).success).toBe(false);
    expect(
      TeamCreateInputSchema.safeParse({ templateId: "eng", identityId: "engineer" }).success,
    ).toBe(false);
  });

  it("refuses an id that could not be a library file", () => {
    expect(TeamCreateInputSchema.safeParse({ templateId: "Eng Team" }).success).toBe(false);
    expect(TeamCreateInputSchema.safeParse({ templateId: "../eng" }).success).toBe(false);
  });

  it("ignores a blank name override instead of creating a nameless group", () => {
    expect(TeamCreateInputSchema.safeParse({ templateId: "eng", name: "   " }).success).toBe(false);
  });

  it("answers with the group and the bots it created", () => {
    expect(TeamCreateOutputSchema.safeParse({}).success).toBe(false);
    expect(TeamCreateOutputSchema.safeParse({ group: {}, bots: [] }).success).toBe(false);
  });
});
