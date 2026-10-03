import type { DelegationRequest, DelegationResult, QueueEntry } from "@rakazo/contracts";

export class DelegationQueue {
  private entries = new Map<string, QueueEntry>();
  private persister?: QueuePersister;

  constructor(persister?: QueuePersister) {
    this.persister = persister;
  }

  async enqueue(request: DelegationRequest): Promise<QueueEntry> {
    const entry: QueueEntry = {
      id: crypto.randomUUID(),
      request,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.entries.set(entry.id, entry);
    await this.persist();
    return entry;
  }

  async assign(entryId: string, botId: string, worktreePath: string): Promise<QueueEntry> {
    const entry = this.entries.get(entryId);
    if (!entry) throw new Error(`Queue entry ${entryId} not found`);
    entry.status = "assigned";
    entry.assignedBotId = botId;
    entry.worktreePath = worktreePath;
    entry.startedAt = new Date().toISOString();
    await this.persist();
    return entry;
  }

  async start(entryId: string): Promise<QueueEntry> {
    const entry = this.entries.get(entryId);
    if (!entry) throw new Error(`Queue entry ${entryId} not found`);
    if (entry.status !== "assigned") throw new Error(`Queue entry ${entryId} not assigned`);
    entry.status = "running";
    await this.persist();
    return entry;
  }

  async complete(entryId: string, result: DelegationResult): Promise<QueueEntry> {
    const entry = this.entries.get(entryId);
    if (!entry) throw new Error(`Queue entry ${entryId} not found`);
    entry.status = result.success ? "done" : "failed";
    entry.result = result;
    entry.completedAt = new Date().toISOString();
    await this.persist();
    return entry;
  }

  async block(entryId: string, reason: string): Promise<QueueEntry> {
    const entry = this.entries.get(entryId);
    if (!entry) throw new Error(`Queue entry ${entryId} not found`);
    entry.status = "blocked";
    entry.result = { success: false, artifacts: [], logs: [reason], error: reason };
    entry.completedAt = new Date().toISOString();
    await this.persist();
    return entry;
  }

  get(entryId: string) {
    return this.entries.get(entryId);
  }

  list(filter?: Partial<Pick<QueueEntry, "status" | "assignedBotId">>) {
    return [...this.entries.values()].filter(
      (e) =>
        (!filter?.status || e.status === filter.status) &&
        (!filter?.assignedBotId || e.assignedBotId === filter.assignedBotId),
    );
  }

  private async persist() {
    if (this.persister) await this.persister.save([...this.entries.values()]);
  }
}

export interface QueuePersister {
  save(entries: QueueEntry[]): Promise<void>;
  load(): Promise<QueueEntry[]>;
}
