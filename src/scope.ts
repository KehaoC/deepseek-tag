/** Conversation-to-agent scope mapping. */

import { createHash } from 'node:crypto'
import type { NormalizedMessage } from '@larksuite/channel'

/**
 * Stable transport scope. DMs share one session; every group topic or reply
 * tree gets its own session, matching Claude Tag's one-session-per-thread model.
 */
export function conversationScope(message: NormalizedMessage): string {
  if (message.chatType === 'p2p') return `dm:${message.chatId}`
  const thread = message.threadId ?? message.rootId ?? message.messageId
  return `group:${message.chatId}:${thread}`
}

/**
 * Derive an opaque durable identity. The runtime key isolates the same Lark
 * thread when its app, workspace, provider, or model changes.
 */
export function createSessionId(scope: string, runtimeKey = ''): string {
  const digest = createHash('sha256')
    .update(runtimeKey)
    .update('\0')
    .update(scope)
    .digest('hex')
    .slice(0, 32)
  return `deepseek-tag:lark:${digest}`
}
