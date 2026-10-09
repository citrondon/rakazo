import { describe, expect, it } from "vitest";
import { applyLegacyEnvAliases, ENV_PREFIX, LEGACY_ENV_PREFIX } from "./env-alias.js";

describe("legacy environment aliases", () => {
  it("copies a legacy name onto the new one", () => {
    const env: NodeJS.ProcessEnv = { RAKAZO_WEB_PORT: "5174" };

    const aliased = applyLegacyEnvAliases(env);

    expect(aliased).toEqual(["BOBBOT_WEB_PORT"]);
    expect(env.BOBBOT_WEB_PORT).toBe("5174");
  });

  it("keeps the new name when a deployment sets both", () => {
    const env: NodeJS.ProcessEnv = { BOBBOT_WEB_PORT: "6000", RAKAZO_WEB_PORT: "5174" };

    const aliased = applyLegacyEnvAliases(env);

    expect(aliased).toEqual([]);
    expect(env.BOBBOT_WEB_PORT).toBe("6000");
  });

  it("copies an empty legacy value so a deployment can keep clearing a setting", () => {
    const env: NodeJS.ProcessEnv = { RAKAZO_IMAGE_TAG: "" };

    expect(applyLegacyEnvAliases(env)).toEqual(["BOBBOT_IMAGE_TAG"]);
    expect(env.BOBBOT_IMAGE_TAG).toBe("");
  });

  it("leaves names it does not own alone", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin", RAKAZOS_TAG: "x", HOME: "/root" };

    expect(applyLegacyEnvAliases(env)).toEqual([]);
    expect(env).toEqual({ PATH: "/usr/bin", RAKAZOS_TAG: "x", HOME: "/root" });
  });

  it("names the prefixes this code reads", () => {
    expect(ENV_PREFIX).toBe("BOBBOT_");
    expect(LEGACY_ENV_PREFIX).toBe("RAKAZO_");
  });
});
