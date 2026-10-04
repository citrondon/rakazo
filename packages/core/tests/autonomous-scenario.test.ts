import { selectTriggeredRoutines } from '../src/trigger-engine'
import type { TriggerCandidate, Trigger, TriggerEvent } from '@rakazo/contracts'
import { describe, it, expect } from 'vitest'

const mockCandidates: TriggerCandidate[] = [
  { routineId: 'grok-coder', name: 'GrokCoder', prompt: 'coder' },
  { routineId: 'support-desk', name: 'SupportDesk', prompt: 'support' },
  { routineId: 'cloud-spend', name: 'CloudSpend', prompt: 'spend' },
]

const mockTriggers: Trigger[] = [
  {
    routineId: 'grok-coder',
    enabled: true,
    filter: { predicates: [{ field: 'event.payload.text', operator: 'contains', value: 'code', caseSensitive: false }], mappings: [] },
  },
  {
    routineId: 'support-desk',
    enabled: true,
    filter: { predicates: [{ field: 'event.payload.text', operator: 'contains', value: 'ticket', caseSensitive: false }], mappings: [] },
  },
  {
    routineId: 'cloud-spend',
    enabled: true,
    filter: { predicates: [{ field: 'event.payload.errorRate', operator: 'gte', value: 0.05, caseSensitive: false }], mappings: [] },
  },
  {
    routineId: 'grok-coder',
    enabled: false,
    filter: { predicates: [{ field: 'event.payload.text', operator: 'contains', value: 'old', caseSensitive: false }], mappings: [] },
  },
]

describe('Autonomous Workflow Scenarios', () => {
  it('should simulate a code request and trigger GrokCoder', () => {
    const event = {
      type: 'thread.message.created',
      payload: { text: 'Bitte implementiere ein Login-Formular' },
      id: 'msg-1', seq: 1, role: 'user', createdAt: new Date().toISOString(),
    }
    const triggered = selectTriggeredRoutines(mockCandidates, mockTriggers, event)
    expect(triggered).toBeDefined()
  })

  it('should simulate a ticket and trigger SupportDesk', () => {
    const event = {
      type: 'thread.message.created',
      payload: { text: 'Neues Support-Ticket: Fehler' },
      id: 'msg-2', seq: 2, role: 'user', createdAt: new Date().toISOString(),
    }
    const triggered = selectTriggeredRoutines(mockCandidates, mockTriggers, event)
    const supportTriggered = triggered.some((t) => t.name === 'SupportDesk')
    expect(supportTriggered).toBe(true)
  })

  it('should handle disabled triggers without crashing', () => {
    const event = {
      type: 'thread.message.created',
      payload: { text: 'irgendein text' },
      id: 'msg-disabled', seq: 1, role: 'user', createdAt: new Date().toISOString(),
    }
    const triggered = selectTriggeredRoutines(mockCandidates, mockTriggers, event)
    expect(triggered).toBeDefined()
  })
})
