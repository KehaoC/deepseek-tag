import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { NormalizedMessage } from '@larksuite/channel'
import { describe, expect, it, vi } from 'vitest'
import { DeepseekTagBridge, type ChannelLike } from '../src/bridge.js'
import { resolveConfig } from '../src/config.js'
import { createSessionId } from '../src/scope.js'

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'om_message',
    chatId: 'oc_chat',
    chatType: 'p2p',
    senderId: 'ou_user',
    content: 'hello',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: false,
    createTime: 1,
    ...overrides,
  }
}

describe('Deepseek Tag bridge', () => {
  it('reuses a conversation agent and replies with each completed turn', async () => {
    let handlers: Parameters<ChannelLike['on']>[0] | undefined
    const replies: string[] = []
    const channel: ChannelLike = {
      on: vi.fn(next => {
        handlers = next
        return vi.fn()
      }),
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      reply: vi.fn(async (_message, input) => {
        replies.push(input.markdown)
      }),
    }
    const events: SessionEvent[] = []
    const prompts: UserMessage[] = []
    let turn = 0
    const handle = {
      agent: {
        session: { events },
        followup(prompt: UserMessage) {
          prompts.push(prompt)
        },
        async whenIdle() {
          turn += 1
          events.push({
            type: 'assistant/message',
            seq: events.length,
            time: events.length,
            data: {
              turn,
              step: 1,
              message: createAssistantMessage({
                content: [{ type: 'text', text: `answer ${String(turn)}` }],
                source: { provider: 'test', model: 'test' },
              }),
            },
          })
          events.push({
            type: 'turn/end',
            seq: events.length,
            time: events.length,
            data: { turn, reason: { kind: 'completed' } },
          })
        },
      },
      dispose: vi.fn(async () => undefined),
    } as unknown as AgentHandle
    const create = vi.fn(async () => handle)
    const resume = vi.fn(async () => handle)
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const persistedId = createSessionId(
      'dm:oc_chat',
      ['feishu', 'cli_test', '', 'deepseek-official', 'deepseek-v4-flash'].join('\0'),
    )
    const ctx = {
      agents: { create, resume },
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
      },
      logger,
      get(service: string) {
        if (service !== 'sessionPersistence') return undefined
        return { list: vi.fn(async () => [{ id: persistedId }]) }
      },
    } as unknown as Context
    const bridge = new DeepseekTagBridge(ctx, {
      config: resolveConfig({ enabled: true, appId: 'cli_test' }),
      appSecret: 'secret',
      createChannel: () => channel,
    })

    await bridge.start()
    await handlers?.message?.(message({ content: 'first' }))
    await handlers?.message?.(message({ messageId: 'om_second', content: 'second' }))

    expect(create).not.toHaveBeenCalled()
    expect(resume).toHaveBeenCalledOnce()
    expect(resume).toHaveBeenCalledWith({
      resumeSessionId: persistedId,
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    expect(prompts.map(prompt => prompt.content[0])).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ])
    expect(replies).toEqual(['answer 1', 'answer 2'])

    await bridge.stop()
    expect(channel.disconnect).toHaveBeenCalledOnce()
    expect(handle.dispose).toHaveBeenCalledOnce()
  })
})
