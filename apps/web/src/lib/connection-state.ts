import type { Connection, ConnectionCatalogItem } from "@bobbot/contracts";

/** What one connection row means to the user: live, waiting, or broken. */
export type ConnectionState = "connected" | "pending" | "expired" | "error" | "removed";

/**
 * `revoked` reads as an expired authorization (the provider no longer lists the
 * account), which is repairable; anything unknown is treated as gone.
 */
export function connectionState(row: Pick<Connection, "status">): ConnectionState {
  switch (row.status) {
    case "connected":
      return "connected";
    case "pending":
      return "pending";
    case "revoked":
      return "expired";
    case "error":
      return "error";
    default:
      return "removed";
  }
}

/** Every row of that provider, so an expired account stays visible instead of disappearing. */
export function connectionRowsFor(
  connections: Connection[],
  item: Pick<ConnectionCatalogItem, "connectorId" | "slug">,
): Connection[] {
  return connections.filter(
    (row) => row.connectorId === item.connectorId && row.provider === item.slug,
  );
}

/** Only the rows that count as an installed connection today. */
export function liveConnectionsFor(
  connections: Connection[],
  item: Pick<ConnectionCatalogItem, "connectorId" | "slug">,
): Connection[] {
  return connectionRowsFor(connections, item).filter((row) => {
    const state = connectionState(row);
    return state === "connected" || state === "pending";
  });
}

/** An expired or failed authorization can be repaired by authorizing again. */
export function canReconnect(state: ConnectionState): boolean {
  return state === "expired" || state === "error";
}
