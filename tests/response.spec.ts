import { describe, expect, it } from 'vitest'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { finalTurnResult } from '../src/response.js'

function assistant(turn: number, step: number, text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq: step,
    time: step,
    data: {
      turn,
      step,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'test', model: 'test' },
      }),
    },
  }
}

describe('final turn projection', () => {
  it('returns only the final visible assistant message', () => {
    const events: SessionEvent[] = [
      assistant(1, 1, 'working'),
      assistant(1, 2, 'final answer'),
      { type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(finalTurnResult(events)).toEqual({ kind: 'reply', text: 'final answer' })
  })

  it('distinguishes empty completion from failed turns', () => {
    expect(finalTurnResult([
      { type: 'turn/end', seq: 0, time: 0, data: { turn: 1, reason: { kind: 'completed' } } },
    ])).toEqual({ kind: 'empty' })
    expect(finalTurnResult([
      { type: 'turn/end', seq: 0, time: 0, data: { turn: 1, reason: { kind: 'max-tokens' } } },
    ])).toEqual({ kind: 'failed' })
  })
})
