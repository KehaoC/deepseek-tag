import { describe, expect, it } from 'vitest'
import type { NormalizedMessage } from '@larksuite/channel'
import { conversationScope, createSessionId } from '../src/scope.js'

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

  it('mints opaque process-unique Harness ids', () => {
    const first = createSessionId('group:oc_secret:om_secret')
    const second = createSessionId('group:oc_secret:om_secret')
    expect(first).toMatch(/^deepseek-tag:lark:[a-f0-9]{24}:[a-f0-9-]{8}$/)
    expect(first).not.toContain('oc_secret')
    expect(first).not.toBe(second)
  })
})
