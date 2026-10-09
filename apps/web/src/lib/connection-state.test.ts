import type { Connection, ConnectionCatalogItem } from "@bobbot/contracts";
import { describe, expect, it } from "vitest";
import {
  canReconnect,
  connectionRowsFor,
  connectionState,
  liveConnectionsFor,
} from "./connection-state";

const ITEM: Pick<ConnectionCatalogItem, "connectorId" | "slug"> = {
  connectorId: "composio",
  slug: "gmail",
};

function row(overrides: Partial<Connection> & Pick<Connection, "status">): Connection {
  return {
    id: `connection-${overrides.status}`,
    connectorId: "composio",
    provider: "gmail",
    displayName: "Gmail",
    capabilities: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("connectionState", () => {
  it("maps every stored status to the state the row renders", () => {
    expect(connectionState(row({ status: "connected" }))).toBe("connected");
    expect(connectionState(row({ status: "pending" }))).toBe("pending");
    expect(connectionState(row({ status: "revoked" }))).toBe("expired");
    expect(connectionState(row({ status: "error" }))).toBe("error");
    expect(connectionState({ status: "something-else" as Connection["status"] })).toBe("removed");
  });
});

describe("connectionRowsFor", () => {
  it("keeps a revoked account visible and preserves input order", () => {
    const connections = [
      row({ status: "revoked", id: "revoked-1" }),
      row({ status: "connected", id: "connected-1" }),
      row({ status: "connected", id: "other", connectorId: "mcp", provider: "gmail" }),
      row({ status: "connected", id: "other-slug", provider: "slack" }),
    ];
    expect(connectionRowsFor(connections, ITEM).map((entry) => entry.id)).toEqual([
      "revoked-1",
      "connected-1",
    ]);
  });
});

describe("liveConnectionsFor", () => {
  it("drops revoked and error rows", () => {
    const connections = [
      row({ status: "revoked", id: "revoked-1" }),
      row({ status: "error", id: "error-1" }),
      row({ status: "pending", id: "pending-1" }),
      row({ status: "connected", id: "connected-1" }),
    ];
    expect(liveConnectionsFor(connections, ITEM).map((entry) => entry.id)).toEqual([
      "pending-1",
      "connected-1",
    ]);
  });
});

describe("canReconnect", () => {
  it("is true only for the states a re-authorization can repair", () => {
    expect(canReconnect("expired")).toBe(true);
    expect(canReconnect("error")).toBe(true);
    expect(canReconnect("connected")).toBe(false);
    expect(canReconnect("pending")).toBe(false);
    expect(canReconnect("removed")).toBe(false);
  });
});
