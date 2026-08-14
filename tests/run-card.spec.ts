import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { NormalizedMessage } from '@larksuite/channel'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  finalizeRunCardState,
  initialRunCardState,
  ManagedRunCard,
  reduceRunCardState,
  renderRunCard,
} from '../src/run-card.js'

function event<T extends SessionEvent>(value: Omit<T, 'seq' | 'time'>): T {
  return { ...value, seq: 0, time: 0 } as T
}

describe('run card projection', () => {
  afterEach(() => { vi.useRealTimers() })

  it('projects stream text, real todos, and redacted tool status', () => {
    let state = initialRunCardState
    state = reduceRunCardState(state, event<SessionEvent<'assistant/chunk'>>({
      type: 'assistant/chunk',
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Checking' } },
    }))
    state = reduceRunCardState(state, event<SessionEvent<'tool/call'>>({
      type: 'tool/call',
      data: { turn: 1, step: 1, callId: 'call_1' as never, name: 'read_file', arguments: '{"token":"secret"}' },
    }))
    state = reduceRunCardState(state, event<SessionEvent<'todo/write'>>({
      type: 'todo/write',
      data: { todos: [{ content: 'Inspect the workspace', status: 'in_progress' }] },
    }))
    state = reduceRunCardState(state, event<SessionEvent<'tool/result'>>({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'message_1' as never,
          role: 'user',
          source: { kind: 'tool', callId: 'call_1' as never },
          content: [{
            type: 'tool-result',
            toolCallId: 'call_1' as never,
            content: [{ type: 'text', text: 'sensitive output' }],
          }],
        },
      },
    }))
    state = reduceRunCardState(state, event<SessionEvent<'assistant/message'>>({
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 2,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'Done.' }],
          source: { provider: 'test', model: 'test' },
        }),
      },
    }))
    const card = JSON.stringify(renderRunCard(finalizeRunCardState(state, 'Done.')))

    expect(card).toContain('Checking\\n\\nDone.')
    expect(card).toContain('Inspect the workspace')
    expect(card).toContain('read_file')
    expect(card).not.toContain('secret')
    expect(card).not.toContain('sensitive output')
  })

  it('updates one managed card with strictly increasing sequences', async () => {
    vi.useFakeTimers()
    const updates: Array<{ sequence: number; card: object }> = []
    const channel = {
      createCard: vi.fn(async () => ({ cardId: 'card_1' })),
      send: vi.fn(async () => ({ messageId: 'message_1' })),
      updateCardById: vi.fn(async (_cardId: string, card: object, sequence: number) => {
        updates.push({ sequence, card })
      }),
    }
    const message: NormalizedMessage = {
      messageId: 'incoming_1', chatId: 'chat_1', chatType: 'p2p', senderId: 'user_1',
      content: 'hello', rawContentType: 'text', resources: [], mentions: [], mentionAll: false,
      mentionedBot: false, createTime: 1,
    }
    const managed = await ManagedRunCard.open(channel, message, initialRunCardState, vi.fn())
    managed.update({ ...initialRunCardState, text: 'partial' })
    await vi.advanceTimersByTimeAsync(180)
    await managed.finish({ ...initialRunCardState, text: 'complete', terminal: 'done' })

    expect(channel.createCard).toHaveBeenCalledOnce()
    expect(channel.send).toHaveBeenCalledWith('chat_1', { cardId: 'card_1' }, {
      replyTo: 'incoming_1', replyInThread: false,
    })
    expect(updates.map(update => update.sequence)).toEqual([1, 2])
    expect(JSON.stringify(updates[1]?.card)).toContain('complete')
    expect(managed.healthy).toBe(true)
  })
})
