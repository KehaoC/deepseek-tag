import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { LarkChannel, NormalizedMessage } from '@larksuite/channel'
import { describe, expect, it, vi } from 'vitest'
import {
  admitsConversationMessage,
  DeepseekTagBridge,
  resolveTopicThread,
  type ChannelLike,
} from '../src/bridge.js'
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
  it('requires the first group mention and admits later thread continuations', () => {
    const group = message({ chatType: 'group', mentionedBot: false })
    expect(admitsConversationMessage(group, true, false)).toBe(false)
    expect(admitsConversationMessage(group, true, true)).toBe(true)
    expect(admitsConversationMessage({ ...group, mentionedBot: true }, true, false)).toBe(true)
    expect(admitsConversationMessage(group, false, false)).toBe(true)
    expect(admitsConversationMessage(message(), true, false)).toBe(true)
  })

  it('backfills a missing topic id from the raw Lark message', async () => {
    const topicRoot = message({ chatType: 'group', chatMode: 'topic' })
    const resolved = await resolveTopicThread(topicRoot, vi.fn(async () => [{ thread_id: 'omt_topic' }]))
    expect(resolved.threadId).toBe('omt_topic')
    const regularGroup = { ...topicRoot, chatMode: 'group' as const }
    expect(await resolveTopicThread(regularGroup, vi.fn())).toBe(regularGroup)
  })

  it('releases each live runtime and resumes the durable conversation', async () => {
    let handlers: Parameters<ChannelLike['on']>[0] | undefined
    const replies: string[] = []
    const addReaction = vi.fn(async () => 'reaction_1')
    const removeReaction = vi.fn(async () => undefined)
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
      addReaction,
      removeReaction,
    }
    const prompts: UserMessage[] = []
    let turn = 0
    const handles: AgentHandle[] = []
    const makeHandle = (): AgentHandle => {
      const events: SessionEvent[] = []
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
      handles.push(handle)
      return handle
    }
    const create = vi.fn(async () => makeHandle())
    const resume = vi.fn(async () => makeHandle())
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const ctx = {
      agents: { create, resume },
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }),
      },
      logger,
      get(service: string) {
        if (service !== 'sessionPersistence') return undefined
        return { list: vi.fn(async () => []) }
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

    const persistedId = createSessionId(
      'dm:oc_chat',
      ['feishu', 'cli_test', '', 'deepseek-official', 'deepseek-v4-flash'].join('\0'),
    )
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith({
      sessionId: persistedId,
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
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
    expect(addReaction).toHaveBeenCalledTimes(2)
    expect(addReaction).toHaveBeenNthCalledWith(1, 'om_message', 'Typing')
    expect(removeReaction).toHaveBeenCalledTimes(2)

    expect(handles).toHaveLength(2)
    expect(handles[0]?.dispose).toHaveBeenCalledOnce()
    expect(handles[1]?.dispose).toHaveBeenCalledOnce()

    await bridge.stop()
    expect(channel.disconnect).toHaveBeenCalledOnce()
    expect(handles[0]?.dispose).toHaveBeenCalledOnce()
    expect(handles[1]?.dispose).toHaveBeenCalledOnce()
  })

  it('projects the live session into one managed reply card', async () => {
    let handlers: Parameters<ChannelLike['on']>[0] | undefined
    const updateCardById = vi.fn<NonNullable<ChannelLike['updateCardById']>>(async () => undefined)
    const reply = vi.fn(async () => undefined)
    const channel: ChannelLike = {
      on: vi.fn(next => { handlers = next; return vi.fn() }),
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      reply,
      createCard: vi.fn(async () => ({ cardId: 'card_1' })),
      send: vi.fn(async () => ({ messageId: 'outgoing_1' })),
      updateCardById,
    }
    const events: SessionEvent[] = []
    type Listener = (session: unknown, event: SessionEvent) => void
    let listener: Listener | undefined
    const session = { events }
    const handle = {
      agent: {
        session,
        ctx: { on: vi.fn((_name: string, next: Listener) => { listener = next; return vi.fn() }) },
        followup: vi.fn(),
        async whenIdle() {
          const emitted: SessionEvent[] = [
            {
              type: 'assistant/chunk', seq: 0, time: 0,
              data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Streaming answer' } },
            },
            {
              type: 'tool/call', seq: 1, time: 1,
              data: { turn: 1, step: 1, callId: 'call_1' as never, name: 'read_file', arguments: '{}' },
            },
            {
              type: 'assistant/message', seq: 2, time: 2,
              data: {
                turn: 1, step: 1,
                message: createAssistantMessage({
                  content: [{ type: 'text', text: 'Streaming answer' }],
                  source: { provider: 'test', model: 'test' },
                }),
              },
            },
            { type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
          ]
          for (const next of emitted) {
            events.push(next)
            listener?.(session, next)
          }
        },
      },
      dispose: vi.fn(async () => undefined),
    } as unknown as AgentHandle
    const ctx = {
      agents: { create: vi.fn(async () => handle), resume: vi.fn() },
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      get: vi.fn(() => ({ list: vi.fn(async () => []) })),
    } as unknown as Context
    const bridge = new DeepseekTagBridge(ctx, {
      config: resolveConfig({ enabled: true, appId: 'cli_test' }),
      appSecret: 'secret',
      createChannel: () => channel,
    })

    await bridge.start()
    await handlers?.message?.(message())

    expect(channel.createCard).toHaveBeenCalledOnce()
    expect(channel.send).toHaveBeenCalledWith('oc_chat', { cardId: 'card_1' }, {
      replyTo: 'om_message', replyInThread: false,
    })
    expect(updateCardById).toHaveBeenCalledOnce()
    expect(updateCardById).toHaveBeenCalledWith('card_1', expect.any(Object), 1)
    expect(JSON.stringify(updateCardById.mock.calls[0]?.[1])).toContain('Streaming answer')
    expect(JSON.stringify(updateCardById.mock.calls[0]?.[1])).toContain('read_file')
    expect(reply).not.toHaveBeenCalled()
    await bridge.stop()
  })

  it('seeds an existing topic and installs chat history in the Agent scope', async () => {
    let handlers: Parameters<ChannelLike['on']>[0] | undefined
    const list = vi.fn(async () => ({
      code: 0,
      data: {
        items: [{
          message_id: 'om_prior',
          thread_id: 'omt_topic',
          chat_id: 'oc_chat',
          msg_type: 'text',
          create_time: '1000',
          body: { content: '{"text":"context before the mention"}' },
          sender: { id: 'ou_prior', sender_type: 'user', sender_name: 'Ada' },
        }],
      },
    }))
    const channel: ChannelLike = {
      rawClient: {
        im: { v1: { message: { list } } },
      } as unknown as LarkChannel['rawClient'],
      botIdentity: { openId: 'ou_bot', name: 'Deepseek Tag' },
      on: vi.fn(next => {
        handlers = next
        return vi.fn()
      }),
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
    }
    const prompts: UserMessage[] = []
    const tools: ToolDefinition[] = []
    const sections: Array<{ name: string; order: number; text: string }> = []
    const events: SessionEvent[] = []
    const handle = {
      agent: {
        session: { events },
        followup(prompt: UserMessage) { prompts.push(prompt) },
        async whenIdle() {
          events.push({
            type: 'assistant/message', seq: 0, time: 0,
            data: {
              turn: 1,
              step: 1,
              message: createAssistantMessage({
                content: [{ type: 'text', text: 'done' }],
                source: { provider: 'test', model: 'test' },
              }),
            },
          })
          events.push({ type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } })
        },
      },
      dispose: vi.fn(async () => undefined),
    } as unknown as AgentHandle
    const create = vi.fn(async (options: { setup?: (ctx: Context) => void }) => {
      options.setup?.({
        systemPrompt: { section: vi.fn((section: { name: string; order: number; text: string }) => {
          sections.push(section)
          return vi.fn()
        }) },
        tools: { register: vi.fn((tool: ToolDefinition) => { tools.push(tool); return vi.fn() }) },
      } as unknown as Context)
      return handle
    })
    const ctx = {
      agents: { create, resume: vi.fn() },
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      get: () => ({ list: vi.fn(async () => []) }),
    } as unknown as Context
    const bridge = new DeepseekTagBridge(ctx, {
      config: resolveConfig({
        enabled: true,
        appId: 'cli_test',
        defaultInstructions: 'Workspace guidance. Keep {{model}} literal.',
        provider: 'workspace-provider',
        model: 'workspace-model',
        cwd: '/workspace',
        groupScopes: [
          { chatId: 'oc_chat', name: 'Summaries', instructions: 'Channel guidance.', provider: 'scoped-provider', model: 'scoped-model', cwd: '/scoped-workspace' },
          { chatId: 'oc_disabled', enabled: false },
        ],
      }),
      appSecret: 'secret',
      createChannel: () => channel,
    })

    await bridge.start()
    await handlers?.message?.(message({
      chatType: 'group',
      chatMode: 'topic',
      threadId: 'omt_topic',
      mentionedBot: true,
      content: 'summarize this',
    }))

    expect(list).toHaveBeenCalledWith({
      params: expect.objectContaining({
        container_id_type: 'thread',
        container_id: 'omt_topic',
        sort_type: 'ByCreateTimeAsc',
        page_size: 50,
      }),
    })
    expect((prompts[0]?.content[0] as { text?: string }).text).toContain('context before the mention')
    expect(tools.map(tool => tool.name)).toContain('deepseek_tag_history')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: 'scoped-provider', model: 'scoped-model' },
      meta: { cwd: '/scoped-workspace' },
    }))
    expect(sections).toContainEqual(expect.objectContaining({
      name: 'deepseek-tag:scope-instructions',
      text: expect.stringContaining('Workspace guidance. Keep {\u200B{model}} literal.\n\nChannel guidance.'),
    }))

    await handlers?.message?.(message({
      chatId: 'oc_disabled',
      chatType: 'group',
      mentionedBot: true,
    }))
    expect(create).toHaveBeenCalledOnce()
    await bridge.stop()
  })
})
