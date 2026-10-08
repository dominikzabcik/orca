import { describe, expect, it } from 'vitest'
import type { AgentJournalItemBody } from '../../shared/agent-session-journal-types'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { CursorJournalTranslator, type CursorTurn } from './cursor-structured-journal'

const TURN: CursorTurn = { sessionId: 'cursor_session', turnId: 'turn-1', startedAt: 1 }

function sink(): { events: StructuredAgentSessionEventSink; bodies: AgentJournalItemBody[] } {
  const bodies: AgentJournalItemBody[] = []
  return {
    bodies,
    events: {
      appendItem(_identity, body) {
        bodies.push(body)
      },
      appendTombstone() {},
      publish() {}
    }
  }
}

describe('CursorJournalTranslator', () => {
  it('records token use and the selected context window on the turn', () => {
    const captured = sink()
    const translator = new CursorJournalTranslator('cursor_session', captured.events)
    translator.setContextWindowTokens(1_000_000)
    translator.openTurn(TURN)
    translator.apply(TURN, {
      type: 'usage',
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      totalTokens: 17
    })
    const turn = captured.bodies.at(-1)
    expect(turn).toMatchObject({
      kind: 'turn',
      state: 'running',
      contextUsage: {
        used: {
          kind: 'estimate',
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            cacheReadInputTokens: 2,
            cacheCreationInputTokens: 1
          }
        },
        window: { tokens: 1_000_000 }
      }
    })
  })

  it('keeps the usage after the turn settles', () => {
    const captured = sink()
    const translator = new CursorJournalTranslator('cursor_session', captured.events)
    translator.setContextWindowTokens(256_000)
    translator.openTurn(TURN)
    translator.apply(TURN, { type: 'result', status: 'finished', result: 'done' })
    translator.apply(TURN, {
      type: 'usage',
      inputTokens: 3,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 4
    })
    const turn = captured.bodies.at(-1)
    expect(turn).toMatchObject({
      kind: 'turn',
      state: 'completed',
      outcome: 'success',
      contextUsage: { window: { tokens: 256_000 } }
    })
  })
})
