import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { LarkChannel, NormalizedMessage } from '@larksuite/channel'
import { describe, expect, it, vi } from 'vitest'
import { TagHistoryAccess, type HistoryChannel, type HistoryMessage } from '../src/history.js'

interface HistoryResult {
  scope: 'chat' | 'thread'
  messages: HistoryMessage[]
}

function trigger(): NormalizedMessage {
  return {
    messageId: 'om_trigger',
    chatId: 'oc_current',
    chatType: 'group',
    chatMode: 'topic',
    threadId: 'omt_current',
    senderId: 'ou_user',
    senderName: 'Kyrie',
    content: 'summarize the channel',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: true,
    createTime: 3,
  }
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    message_id: 'om_root',
    thread_id: 'omt_sibling',
    chat_id: 'oc_current',
    msg_type: 'text',
    create_time: '1000',
    body: { content: JSON.stringify({ text: 'root message' }) },
    sender: { id: 'ou_sender', sender_type: 'user', sender_name: 'Ada' },
    ...overrides,
  }
}

function accessWith(
  list: (payload: unknown) => Promise<unknown>,
): { access: TagHistoryAccess; list: ReturnType<typeof vi.fn> } {
  const listMock = vi.fn(list)
  const channel: HistoryChannel = {
    rawClient: {
      im: { v1: { message: { list: listMock } } },
    } as unknown as LarkChannel['rawClient'],
    botIdentity: { openId: 'ou_bot', name: 'Deepseek Tag' },
  }
  return { access: new TagHistoryAccess(channel, trigger()), list: listMock }
}

function toolFor(access: TagHistoryAccess): ToolDefinition {
  let tool: ToolDefinition | undefined
  const ctx = {
    systemPrompt: { section: vi.fn(() => vi.fn()) },
    tools: {
      register: vi.fn((definition: ToolDefinition) => {
        tool = definition
        return vi.fn()
      }),
    },
  } as unknown as Context
  access.install(ctx)
  if (tool === undefined) throw new Error('history tool was not registered')
  return tool
}

async function execute(tool: ToolDefinition, arguments_: object): Promise<HistoryResult> {
  return await tool.execute(arguments_, {} as ToolRunContext) as unknown as HistoryResult
}

describe('Deepseek Tag history access', () => {
  it('discovers an opaque sibling-thread reference and reads only that current-chat thread', async () => {
    const { access, list } = accessWith(async payload => {
      const params = (payload as { params: { container_id_type: string } }).params
      return params.container_id_type === 'chat'
        ? {
            code: 0,
            data: { items: [
              item({ message_id: 'om_new', thread_id: 'omt_new', create_time: '2000', body: { content: '{"text":"new"}' } }),
              item(),
            ] },
          }
        : {
            code: 0,
            data: { items: [item({ message_id: 'om_reply', body: { content: '{"text":"reply"}' } })] },
          }
    })
    const tool = toolFor(access)

    const chat = await execute(tool, { action: 'read_chat' })
    expect(chat.messages.map(message => message.content)).toEqual(['root message', 'new'])
    const reference = chat.messages[0]?.threadRef
    expect(reference).toMatch(/^thread_[a-f0-9]{12}$/)
    expect(JSON.stringify(chat)).not.toContain('omt_sibling')

    const thread = await execute(tool, { action: 'read_thread', thread_ref: reference })
    expect(thread.messages.map(message => message.content)).toEqual(['reply'])
    expect(list).toHaveBeenLastCalledWith({
      params: expect.objectContaining({ container_id_type: 'thread', container_id: 'omt_sibling' }),
    })
  })

  it('rejects a sibling thread returned from another chat and seeds only human prior messages', async () => {
    let crossChat = false
    const { access } = accessWith(async payload => {
      const params = (payload as { params: { container_id_type: string; sort_type: string } }).params
      if (crossChat) return { code: 0, data: { items: [item({ chat_id: 'oc_other' })] } }
      if (params.container_id_type === 'chat') {
        return { code: 0, data: { items: [item()] } }
      }
      expect(params.sort_type).toBe('ByCreateTimeAsc')
      return {
        code: 0,
        data: { items: [
          item({ message_id: 'om_old', thread_id: 'omt_current', body: { content: '{"text":"human context"}' } }),
          item({ message_id: 'om_bot', thread_id: 'omt_current', sender: { id: 'ou_bot', sender_type: 'app', sender_name: 'Bot' } }),
          item({ message_id: 'om_trigger', thread_id: 'omt_current' }),
        ] },
      }
    })

    expect((await access.initialThreadContext()).map(message => message.content)).toEqual(['human context'])

    const tool = toolFor(access)
    const chat = await execute(tool, { action: 'read_chat' })
    const reference = chat.messages[0]?.threadRef
    crossChat = true
    await expect(execute(tool, { action: 'read_thread', thread_ref: reference }))
      .rejects.toThrow(/does not belong to the current chat/)
  })
})
