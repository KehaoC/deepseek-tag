/** Conversation-to-agent scope mapping. */

import { createHash } from 'node:crypto'
import type { NormalizedMessage } from '@larksuite/channel'
import type { LarkTenant } from './contract.js'

/** Memory visibility resolved from one Lark place. */
export interface MemoryAccess {
  /** Ordered scopes visible to the conversation. */
  readKeys: readonly string[]
  /** The only scope this conversation may mutate. */
  writeKey: string
  /** Human-readable policy label used in the Agent context. */
  writeScope: 'workspace' | 'channel' | 'direct-message'
}

/** Workspace/channel/thread identity for one admitted message. */
export interface ConversationPlace {
  kind: 'direct-message' | 'group'
  workspaceKey: string
  channelKey: string
  threadKey: string
  memory: MemoryAccess
}

interface PlaceConfig {
  tenant: LarkTenant
  appId: string
  workspaceMemoryGroups: readonly string[]
}

/** Derive an opaque durable key without writing raw transport ids to storage. */
function placeKey(kind: string, ...parts: string[]): string {
  const digest = createHash('sha256')
    .update(parts.join('\0'))
    .digest('hex')
    .slice(0, 32)
  return `${kind}:${digest}`
}

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
 * Resolve Claude Tag's workspace/channel/thread hierarchy onto Lark.
 *
 * One app installation is one workspace, a group chat is one channel, and a
 * topic/reply tree is one thread. Lark does not expose Slack's public/private
 * channel classification, so groups are private by default. Administrators
 * explicitly opt selected groups into workspace-shared memory.
 */
export function conversationPlace(message: NormalizedMessage, config: PlaceConfig): ConversationPlace {
  const workspaceKey = placeKey('workspace', config.tenant, config.appId)
  const thread = message.chatType === 'p2p'
    ? message.chatId
    : message.threadId ?? message.rootId ?? message.messageId
  const threadKey = placeKey('thread', workspaceKey, message.chatId, thread)

  if (message.chatType === 'p2p') {
    const channelKey = placeKey('dm', workspaceKey, message.chatId)
    return {
      kind: 'direct-message',
      workspaceKey,
      channelKey,
      threadKey,
      memory: {
        readKeys: [channelKey],
        writeKey: channelKey,
        writeScope: 'direct-message',
      },
    }
  }

  const channelKey = placeKey('channel', workspaceKey, message.chatId)
  const sharesWorkspace = config.workspaceMemoryGroups.includes(message.chatId)
  return {
    kind: 'group',
    workspaceKey,
    channelKey,
    threadKey,
    memory: sharesWorkspace
      ? {
          readKeys: [workspaceKey],
          writeKey: workspaceKey,
          writeScope: 'workspace',
        }
      : {
          readKeys: [workspaceKey, channelKey],
          writeKey: channelKey,
          writeScope: 'channel',
        },
  }
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
