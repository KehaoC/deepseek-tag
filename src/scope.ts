/** Conversation-to-agent scope mapping. */

import { createHash, randomUUID } from 'node:crypto'
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

/** Mint a process-unique Harness session id without exposing Lark identifiers. */
export function createSessionId(scope: string): string {
  const digest = createHash('sha256').update(scope).digest('hex').slice(0, 24)
  return `deepseek-tag:lark:${digest}:${randomUUID().slice(0, 8)}`
}
