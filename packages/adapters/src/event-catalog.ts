import type { EventDefinition } from "@bobbot/contracts";

/**
 * The events a routine can react to, described provider-neutrally. Each entry names the
 * provider and type a filter or mapping can address, plus the fields those rules should
 * offer. The catalog is data only: a provider adapter still translates its own webhook into
 * a `TriggerEvent`, and no vendor SDK is named here.
 */

export type { EventDefinition };

export const EVENT_CATALOG: readonly EventDefinition[] = [
  {
    id: "github:issues",
    provider: "github",
    type: "issues",
    source: "connector",
    label: "GitHub issue",
    fields: [
      "payload.action",
      "payload.issue.title",
      "payload.issue.labels",
      "payload.issue.html_url",
      "payload.repository.full_name",
      "payload.sender.login",
    ],
  },
  {
    id: "github:pull_request",
    provider: "github",
    type: "pull_request",
    source: "connector",
    label: "GitHub pull request",
    fields: [
      "payload.action",
      "payload.pull_request.title",
      "payload.pull_request.base.ref",
      "payload.repository.full_name",
      "payload.sender.login",
    ],
  },
  {
    id: "slack:message",
    provider: "slack",
    type: "message",
    source: "connector",
    label: "Slack message",
    fields: ["payload.text", "payload.channel", "payload.user"],
  },
  {
    id: "gmail:message",
    provider: "gmail",
    type: "message",
    source: "connector",
    label: "Gmail message",
    fields: ["payload.subject", "payload.from", "payload.labelIds"],
  },
  {
    id: "linear:issue",
    provider: "linear",
    type: "issue",
    source: "connector",
    label: "Linear issue",
    fields: ["payload.action", "payload.title", "payload.team", "payload.labels"],
  },
  {
    id: "sentry:issue",
    provider: "sentry",
    type: "issue",
    source: "connector",
    label: "Sentry issue",
    fields: ["payload.title", "payload.project", "payload.level", "payload.url"],
  },
  {
    id: "pagerduty:incident",
    provider: "pagerduty",
    type: "incident",
    source: "connector",
    label: "PagerDuty incident",
    fields: ["payload.title", "payload.service", "payload.urgency", "payload.url"],
  },
  {
    id: "teams:message",
    provider: "teams",
    type: "message",
    source: "connector",
    label: "Teams message",
    fields: ["payload.text", "payload.channel", "payload.user"],
  },
  {
    id: "webhook:generic",
    provider: "webhook",
    type: "generic",
    source: "webhook",
    label: "Inbound webhook",
    fields: ["payload"],
  },
];

export function eventDefinitionId(provider: string, type: string): string {
  return `${provider}:${type}`;
}

export function listEventDefinitions(provider?: string): EventDefinition[] {
  if (!provider) return [...EVENT_CATALOG];
  return EVENT_CATALOG.filter((entry) => entry.provider === provider);
}

export function findEventDefinition(id: string): EventDefinition | undefined {
  return EVENT_CATALOG.find((entry) => entry.id === id);
}
