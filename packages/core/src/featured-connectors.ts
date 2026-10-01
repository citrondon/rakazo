import type { ConnectionCatalogItem } from "@rakazo/contracts";

export const FEATURED_CONNECTOR_IDS = [
  "gmail",
  "google-calendar",
  "google-drive",
  "slack",
  "notion",
] as const;

export type FeaturedConnectorId = (typeof FEATURED_CONNECTOR_IDS)[number];

export const FEATURED_CONNECTOR_LABELS: Record<FeaturedConnectorId, string> = {
  gmail: "Gmail",
  "google-calendar": "Google Calendar",
  "google-drive": "Google Drive",
  slack: "Slack",
  notion: "Notion",
};

const FEATURED_ALIASES: Record<FeaturedConnectorId, readonly string[]> = {
  gmail: ["gmail", "googlemail", "google mail"],
  "google-calendar": ["googlecalendar", "google calendar", "google_calendar", "gcal"],
  "google-drive": ["googledrive", "google drive", "google_drive", "gdrive"],
  slack: ["slack", "slackbot"],
  notion: ["notion", "notion.so"],
};

export type FeaturedConnectorTile = {
  id: FeaturedConnectorId;
  label: string;
  item?: ConnectionCatalogItem;
  /** Catalog has items but none matched this featured connector. */
  missing: boolean;
};

/** Keep catalog screens responsive even when a provider exposes thousands of apps. */
export const CONNECTION_CATALOG_PAGE_SIZE = 60;

function normalizeConnectorKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function matchFeaturedConnectorId(value: string): FeaturedConnectorId | null {
  const normalized = normalizeConnectorKey(value);
  if (!normalized) return null;
  for (const id of FEATURED_CONNECTOR_IDS) {
    if (FEATURED_ALIASES[id].some((alias) => normalizeConnectorKey(alias) === normalized)) {
      return id;
    }
  }
  return null;
}

export function featuredConnectorProvidersMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const leftId = matchFeaturedConnectorId(left);
  const rightId = matchFeaturedConnectorId(right);
  return leftId !== null && leftId === rightId;
}

export function resolveFeaturedCatalogItem(
  id: FeaturedConnectorId,
  catalog: readonly ConnectionCatalogItem[],
): ConnectionCatalogItem | undefined {
  for (const item of catalog) {
    if (matchFeaturedConnectorId(item.slug) === id) return item;
    if (matchFeaturedConnectorId(item.name) === id) return item;
  }
  return undefined;
}

export function buildFeaturedConnectorTiles(
  catalog: readonly ConnectionCatalogItem[],
): FeaturedConnectorTile[] {
  const hasCatalog = catalog.length > 0;
  return FEATURED_CONNECTOR_IDS.map((id) => {
    const item = hasCatalog ? resolveFeaturedCatalogItem(id, catalog) : undefined;
    return {
      id,
      label: FEATURED_CONNECTOR_LABELS[id],
      item,
      missing: hasCatalog && !item,
    };
  });
}

export function filterConnectionCatalogItems(
  catalog: readonly ConnectionCatalogItem[],
  query: string,
): ConnectionCatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return catalog.filter(
      (item) =>
        matchFeaturedConnectorId(item.slug) === null &&
        matchFeaturedConnectorId(item.name) === null,
    );
  }
  return catalog.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.slug.toLowerCase().includes(needle) ||
      item.connectorId.toLowerCase().includes(needle),
  );
}

/** Group id for catalog rows a provider shipped without any category. */
export const CONNECTION_CATALOG_UNCATEGORIZED_ID = "uncategorized";

export type ConnectionCatalogGroup = {
  id: string;
  /** Category name as the provider spells it; empty for the uncategorized bucket. */
  label: string;
  items: ConnectionCatalogItem[];
};

function categoryGroupId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || CONNECTION_CATALOG_UNCATEGORIZED_ID;
}

/**
 * Buckets catalog rows into ordered category sections using the provider's own
 * category hints, so a thousand-app catalog reads as a handful of tidy groups.
 * Named groups sort alphabetically; rows without a category trail them in a
 * single unlabeled bucket. Row order inside a group is preserved (catalogs
 * arrive popularity-ordered).
 */
export function groupConnectionCatalogItems(
  items: readonly ConnectionCatalogItem[],
): ConnectionCatalogGroup[] {
  const groups = new Map<string, ConnectionCatalogGroup>();
  const uncategorized: ConnectionCatalogItem[] = [];
  for (const item of items) {
    const label = (item.categories ?? [])
      .map((value) => value.trim())
      .find((value) => value.length);
    if (!label) {
      uncategorized.push(item);
      continue;
    }
    const id = categoryGroupId(label);
    const existing = groups.get(id);
    if (existing) existing.items.push(item);
    else groups.set(id, { id, label, items: [item] });
  }
  const ordered = [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
  if (uncategorized.length > 0) {
    ordered.push({ id: CONNECTION_CATALOG_UNCATEGORIZED_ID, label: "", items: uncategorized });
  }
  return ordered;
}

export const EMPTY_PLUGIN_CATALOG_MESSAGE =
  "Configure a plugin catalog on the server to connect apps.";
