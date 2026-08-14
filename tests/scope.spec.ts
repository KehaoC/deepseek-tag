import { describe, expect, it } from 'vitest'
import type { NormalizedMessage } from '@larksuite/channel'
import { conversationPlace, conversationScope, createSessionId } from '../src/scope.js'

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'om_root',
    chatId: 'oc_chat',
    chatType: 'group',
    senderId: 'ou_user',
    content: 'hello',
    rawContentType: 'text',
    resources: [],
    mentions: [],
    mentionAll: false,
    mentionedBot: true,
    createTime: 1,
    ...overrides,
  }
}

describe('conversation scopes', () => {
  it('shares one direct-message session per chat', () => {
    expect(conversationScope(message({ chatType: 'p2p', messageId: 'om_a' })))
      .toBe(conversationScope(message({ chatType: 'p2p', messageId: 'om_b' })))
  })

  it('isolates group sessions by topic or reply root', () => {
    expect(conversationScope(message({ threadId: 'omt_topic' }))).toBe('group:oc_chat:omt_topic')
    expect(conversationScope(message({ rootId: 'om_parent' }))).toBe('group:oc_chat:om_parent')
    expect(conversationScope(message())).toBe('group:oc_chat:om_root')
  })

  it('mints opaque durable ids isolated by runtime configuration', () => {
    const first = createSessionId('group:oc_secret:om_secret')
    const second = createSessionId('group:oc_secret:om_secret')
    const otherRuntime = createSessionId('group:oc_secret:om_secret', 'other-runtime')
    expect(first).toMatch(/^deepseek-tag:lark:[a-f0-9]{32}$/)
    expect(first).not.toContain('oc_secret')
    expect(first).toBe(second)
    expect(first).not.toBe(otherRuntime)
  })

  it('maps groups to channel memory and explicitly shared groups to workspace memory', () => {
    const config = { tenant: 'feishu' as const, appId: 'cli_test', workspaceMemoryGroups: ['oc_shared'] }
    const privatePlace = conversationPlace(message({ chatId: 'oc_private', threadId: 'omt_one' }), config)
    const otherThread = conversationPlace(message({ chatId: 'oc_private', threadId: 'omt_two' }), config)
    const sharedPlace = conversationPlace(message({ chatId: 'oc_shared', threadId: 'omt_three' }), config)

    expect(privatePlace.channelKey).toBe(otherThread.channelKey)
    expect(privatePlace.threadKey).not.toBe(otherThread.threadKey)
    expect(privatePlace.memory).toEqual({
      readKeys: [privatePlace.workspaceKey, privatePlace.channelKey],
      writeKey: privatePlace.channelKey,
      writeScope: 'channel',
    })
    expect(sharedPlace.memory).toEqual({
      readKeys: [sharedPlace.workspaceKey],
      writeKey: sharedPlace.workspaceKey,
      writeScope: 'workspace',
    })
    expect(privatePlace.workspaceKey).toBe(sharedPlace.workspaceKey)
    expect(JSON.stringify(privatePlace)).not.toContain('oc_private')
  })

  it('keeps direct-message memory isolated from workspace and group memory', () => {
    const place = conversationPlace(message({ chatType: 'p2p', chatId: 'oc_dm' }), {
      tenant: 'lark',
      appId: 'cli_test',
      workspaceMemoryGroups: [],
    })
    expect(place.memory).toEqual({
      readKeys: [place.channelKey],
      writeKey: place.channelKey,
      writeScope: 'direct-message',
    })
  })
})
