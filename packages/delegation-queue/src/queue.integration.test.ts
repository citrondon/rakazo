import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { DelegationQueue, QueuePersister } from './queue'
import type { QueueEntry, DelegationRequest, DelegationResult } from '@rakazo/contracts'

// In-Memory Persister für Tests
class InMemoryPersister implements QueuePersister {
  private entries: QueueEntry[] = []

  async save(entries: QueueEntry[]): Promise<void> {
    this.entries = entries
  }

  async load(): Promise<QueueEntry[]> {
    return this.entries
  }
}

describe('Delegation Queue Persistence', () => {
  let queue: DelegationQueue
  let persister: QueuePersister

  beforeEach(() => {
    persister = new InMemoryPersister()
    queue = new DelegationQueue(persister)
  })

  afterEach(() => {
    // Cleanup nach jedem Test: Persister zurücksetzen
    persister = new InMemoryPersister()
    queue = new DelegationQueue(persister)
  })

  it('should enqueue and maintain status through persister cycle', async () => {
    // Enqueue eine Request - ID wird automatisch generiert (UUID)
    const request: DelegationRequest = {
      type: 'test',
      payload: { message: 'hello' }
    }

    const entry = await queue.enqueue(request)
    // Die ID ist eine UUID, nicht der Parameter
    expect(entry.status).toBe('pending')
    expect(entry.id).toBeDefined()
    const entryId = entry.id

    // Persister speichern und laden
    await queue.persister!.save([entry])
    const loaded = await queue.persister!.load()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].status).toBe('pending')
    expect(loaded[0].id).toBe(entryId)
  })

  it('should maintain assignment across persister cycles', async () => {
    // Enqueue eine Request
    const request: DelegationRequest = {
      type: 'assign',
      payload: { task: 'code review' }
    }

    const entry = await queue.enqueue(request)
    expect(entry.status).toBe('pending')

    // Assignment zuweisen (erforderlich vor start!)
    const assigned = await queue.assign(entry.id, 'bot-1', '/workspace')
    expect(assigned.status).toBe('assigned')
    expect(assigned.assignedBotId).toBe('bot-1')
    expect(assigned.worktreePath).toBe('/workspace')
    expect(assigned.startedAt).toBeDefined()

    // Persister speichern und laden
    await queue.persister!.save([assigned])
    const loaded = await queue.persister!.load()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].status).toBe('assigned')
    expect(loaded[0].assignedBotId).toBe('bot-1')
    expect(loaded[0].worktreePath).toBe('/workspace')
  })

  it('should maintain running status across persister cycles', async () => {
    // Enqueue und assignment (erforderlich vor start!)
    const request: DelegationRequest = {
      type: 'run',
      payload: { script: 'test.js' }
    }

    const entry = await queue.enqueue(request)
    const assigned = await queue.assign(entry.id, 'bot-2', '/tasks')

    // Start (erfordert status "assigned")
    const running = await queue.start(assigned.id)
    expect(running.status).toBe('running')
    expect(running.startedAt).toBeDefined()

    // Persister speichern und laden
    await queue.persister!.save([running])
    const loaded = await queue.persister!.load()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].status).toBe('running')
    expect(loaded[0].startedAt).toBeDefined()
  })

  it('should maintain completion status across persister cycles', async () => {
    // Enqueue, assignment, start, completion
    const request: DelegationRequest = {
      type: 'complete',
      payload: { result: 'success' }
    }

    const entry = await queue.enqueue(request)
    const assigned = await queue.assign(entry.id, 'bot-3', '/work')
    const started = await queue.start(assigned.id)

    // Complete
    const completed = await queue.complete(assigned.id, {
      success: true,
      artifacts: [],
      logs: ['Task completed successfully'],
    })

    expect(completed.status).toBe('done')
    expect(completed.result).toBeDefined()
    expect(completed.result?.success).toBe(true)

    // Persister speichern und laden
    await queue.persister!.save([completed])
    const loaded = await queue.persister!.load()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].status).toBe('done')
    expect(loaded[0].result?.success).toBe(true)
  })

  it('should maintain blocked status across persister cycles', async () => {
    // Enqueue und assignment
    const request: DelegationRequest = {
      type: 'block',
      payload: { task: 'dangerous operation' }
    }

    const entry = await queue.enqueue(request)
    const assigned = await queue.assign(entry.id, 'bot-4', '/safe')

    // Block
    const blocked = await queue.block(assigned.id, 'Safety policy violation')
    expect(blocked.status).toBe('blocked')
    expect(blocked.result).toBeDefined()
    expect(blocked.result?.success).toBe(false)
    expect(blocked.result?.error).toBe('Safety policy violation')

    // Persister speichern und laden
    await queue.persister!.save([blocked])
    const loaded = await queue.persister!.load()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].status).toBe('blocked')
    expect(loaded[0].result?.error).toBe('Safety policy violation')
  })

  it('should list entries with filters across persister cycles', async () => {
    // Zuerst Queue komplett zurücksetzen durch Neuerstellung
    persister = new InMemoryPersister()
    queue = new DelegationQueue(persister)

    // Enqueue 3 test Einträge
    await queue.enqueue({ type: 'test', payload: { a: 1 } })
    await queue.enqueue({ type: 'test', payload: { b: 2 } })
    await queue.enqueue({ type: 'test', payload: { c: 3 } })

    // Einen zuweisen
    const assignedEntry = await queue.enqueue({ type: 'assign', payload: { task: 'test' } })
    await queue.assign(assignedEntry.id, 'bot-a', '/w1')

    // List mit Filtern - fresh Queue Instance
    const allEntries = queue.list()
    expect(allEntries).toHaveLength(4) // 3 test + 1 assigned

    // Mindestens einen assigned Eintrag finden
    const assignedEntries = queue.list({ status: 'assigned' })
    expect(assignedEntries).toHaveLength(1)
    expect(assignedEntries[0].id).toBeDefined()

    // Mindestens einen pending Eintrag finden
    const pendingEntries = queue.list({ status: 'pending' })
    expect(pendingEntries).toHaveLength(3) // die drei nicht-zugewiesenen
  })
})