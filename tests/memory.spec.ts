import type { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { TagMemoryStore } from '../src/memory.js'
import { conversationPlace, type ConversationPlace } from '../src/scope.js'
import type { NormalizedMessage } from '@larksuite/channel'

interface RecordValue {
  notes: Array<{
    id: string
    text: string
    createdAt: string
    updatedAt: string
    createdBy: string
  }>
}

function message(chatId: string, chatType: 'p2p' | 'group' = 'group'): NormalizedMessage {
  return {
    messageId: 'om_root',
    chatId,
    chatType,
    senderId: 'ou_user',
    content: 'hello',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: chatType === 'group',
    createTime: 1,
  }
}

function memoryTable(): KvTable<string, RecordValue> {
  const records = new Map<string, RecordValue>()
  return {
    get: key => records.get(key),
    entries: () => new Map(records).entries(),
    keys: () => new Map(records).keys(),
    get size() { return records.size },
    async put(key, value) { records.set(key, value) },
    async delete(key) { return records.delete(key) },
    async update(key, transform) {
      const current = records.get(key)
      if (current === undefined) throw new Error('missing')
      const next = transform(current)
      records.set(key, next)
      return next
    },
  }
}

function toolFor(store: TagMemoryStore, place: ConversationPlace): ToolDefinition {
  let tool: ToolDefinition | undefined
  const ctx = {
    systemPrompt: {
      section: vi.fn(() => vi.fn()),
      context: vi.fn(() => vi.fn()),
    },
    tools: {
      register: vi.fn((definition: ToolDefinition) => {
        tool = definition
        return vi.fn()
      }),
    },
  } as unknown as Context
  store.install(ctx, place, 'Kyrie')
  if (tool === undefined) throw new Error('memory tool was not registered')
  return tool
}

async function execute(tool: ToolDefinition, arguments_: object): Promise<{ notes: RecordValue['notes'] }> {
  return await tool.execute(arguments_, {} as ToolRunContext) as { notes: RecordValue['notes'] }
}

describe('Deepseek Tag memory', () => {
  it('shares workspace notes read-only with private groups and isolates DMs', async () => {
    const store = new TagMemoryStore(memoryTable())
    const config = { tenant: 'feishu' as const, appId: 'cli_test', workspaceMemoryGroups: ['oc_shared'] }
    const shared = conversationPlace(message('oc_shared'), config)
    const privateGroup = conversationPlace(message('oc_private'), config)
    const dm = conversationPlace(message('oc_dm', 'p2p'), config)

    const sharedTool = toolFor(store, shared)
    const remembered = await execute(sharedTool, { action: 'remember', text: 'Deploys happen on Tuesdays.' })
    const workspaceNote = remembered.notes[0]
    expect(workspaceNote?.text).toBe('Deploys happen on Tuesdays.')

    const privateTool = toolFor(store, privateGroup)
    expect((await execute(privateTool, { action: 'list' })).notes).toEqual(remembered.notes)
    await expect(execute(privateTool, { action: 'forget', note_id: workspaceNote?.id }))
      .rejects.toThrow(/not writable/)

    const privateResult = await execute(privateTool, { action: 'remember', text: 'This group uses staging.' })
    expect(privateResult.notes.map(note => note.text)).toEqual([
      'Deploys happen on Tuesdays.',
      'This group uses staging.',
    ])
    expect((await execute(sharedTool, { action: 'list' })).notes).toEqual(remembered.notes)
    expect((await execute(toolFor(store, dm), { action: 'list' })).notes).toEqual([])
  })
})
