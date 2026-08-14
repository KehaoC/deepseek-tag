/** Feishu/Lark channel to DeepSeek Harness agent bridge. */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  createLarkChannel,
  type LarkChannel,
  type LarkChannelError,
  type NormalizedMessage,
} from '@larksuite/channel'
import type { ResolvedConfig } from './config.js'
import { ConversationQueue } from './conversation-queue.js'
import {
  renderInitialThreadContext,
  supportsHistory,
  TagHistoryAccess,
} from './history.js'
import type { TagMemoryStore } from './memory.js'
import { finalTurnResult } from './response.js'
import {
  finalizeRunCardState,
  initialRunCardState,
  ManagedRunCard,
  reduceRunCardState,
  runCardNeedsContinuation,
  type ManagedCardChannel,
  type RunCardState,
} from './run-card.js'
import { conversationPlace, conversationScope, createSessionId } from './scope.js'

/** Narrow channel surface used by production and test transports. */
export interface ChannelLike {
  on(handlers: {
    message?: (message: NormalizedMessage) => void | Promise<void>
    error?: (error: LarkChannelError) => void
    reconnecting?: () => void
    reconnected?: () => void
  }): () => void
  connect(): Promise<void>
  disconnect(): Promise<void>
  reply(message: NormalizedMessage, input: { markdown: string }): Promise<unknown>
  createCard?: ManagedCardChannel['createCard']
  send?: ManagedCardChannel['send']
  updateCardById?: ManagedCardChannel['updateCardById']
  addReaction?(messageId: string, emojiType: string): Promise<string>
  removeReaction?(messageId: string, reactionId: string): Promise<void>
  fetchRawMessage?(messageId: string): Promise<unknown[]>
  readonly rawClient?: LarkChannel['rawClient']
  botIdentity?: LarkChannel['botIdentity']
}

/** Bridge construction seams. */
export interface BridgeOptions {
  config: ResolvedConfig
  appSecret: string
  memory?: TagMemoryStore
  createChannel?: (config: ResolvedConfig, appSecret: string) => ChannelLike
}

const ATTACHMENT_NOTICE = 'This version of Deepseek Tag can read text only; attachments in this message were not included.'
const EMPTY_RESPONSE = 'The agent finished without a text response.'
const FAILED_RESPONSE = 'I couldn\'t finish that request. Please try again or check the DeepSeek Harness logs.'
// Feishu's published emoji_type vocabulary has no whale; use the channel
// reference implementation's native working indicator instead.
const WORKING_REACTION = 'Typing'

/** Stable error text for logs regardless of the thrown shape. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Session-aware mention policy applied after the transport's coarse gates. */
export function admitsConversationMessage(
  message: NormalizedMessage,
  requireMention: boolean,
  sessionExists: boolean,
): boolean {
  return message.chatType === 'p2p' || !requireMention || message.mentionedBot || sessionExists
}

/** Backfill the topic id that Feishu sometimes omits from root-message events. */
export async function resolveTopicThread(
  message: NormalizedMessage,
  fetchRawMessage: ((messageId: string) => Promise<unknown[]>) | undefined,
): Promise<NormalizedMessage> {
  if (message.chatType !== 'group'
    || message.chatMode !== 'topic'
    || message.threadId !== undefined
    || fetchRawMessage === undefined) return message
  const [raw] = await fetchRawMessage(message.messageId)
  const threadId = (raw as { thread_id?: unknown } | undefined)?.thread_id
  return typeof threadId === 'string' && threadId.length > 0 ? { ...message, threadId } : message
}

/** Create the production Lark WebSocket channel. */
export function productionChannel(config: ResolvedConfig, appSecret: string): LarkChannel {
  return createLarkChannel({
    appId: config.appId,
    appSecret,
    domain: config.tenant === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn',
    source: 'deepseek-tag',
    resolveChatMode: true,
    resolveSenderNames: true,
    policy: {
      dmMode: config.dmMode,
      dmAllowlist: config.dmAllowlist,
      groupAllowlist: config.groupAllowlist,
      // Continuations in an existing thread do not require another mention.
      // The bridge owns that session-aware gate; the transport cannot know
      // whether a durable Harness session already exists.
      requireMention: false,
      respondToMentionAll: false,
    },
    safety: {
      // A Lark group may contain independent topics. The bridge serializes by
      // durable conversation scope instead of blocking the whole chat.
      chatQueue: { enabled: false },
    },
    keepalive: { enabled: true },
    wsConfig: { pingTimeout: 3 },
    handshakeTimeoutMs: 8_000,
    httpTimeoutMs: 30_000,
    respectProxyEnv: true,
  })
}

/**
 * Own one channel connection and activate a fresh Harness runtime for each
 * delivered turn. The durable session survives each activation; disposing the
 * handle after idle releases the live agent and its session-scoped sandbox.
 * Message handlers wait for their turn so the SDK's per-chat queue keeps reply
 * targets ordered.
 */
export class DeepseekTagBridge {
  private readonly channel: ChannelLike
  private readonly agentOptions: AgentOptions
  private readonly runtimeKey: string
  private readonly queue = new ConversationQueue()
  private readonly active = new Set<Promise<void>>()
  private readonly persistedSessionIds = new Set<string>()
  private unsubscribe: (() => void) | undefined
  private stopped = false

  constructor(private readonly ctx: Context, private readonly options: BridgeOptions) {
    this.channel = (options.createChannel ?? productionChannel)(options.config, options.appSecret)
    const selected = options.config.provider === ''
      ? ctx.agentDefaultModel.currentSelection()
      : { provider: options.config.provider, model: options.config.model }
    this.agentOptions = { provider: selected.provider, model: selected.model }
    this.runtimeKey = [
      options.config.tenant,
      options.config.appId,
      options.config.cwd,
      selected.provider,
      selected.model,
    ].join('\0')
  }

  /** Subscribe before connecting so no first message is missed. */
  async start(): Promise<void> {
    if (this.unsubscribe !== undefined) return
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence !== undefined) {
      const headers = await persistence.list()
      for (const header of headers) {
        if (header.id.startsWith('deepseek-tag:lark:')) this.persistedSessionIds.add(header.id)
      }
    }
    this.unsubscribe = this.channel.on({
      message: message => this.track(this.handleMessage(message)),
      error: error => {
        this.ctx.logger.warn('[deepseek-tag] Lark channel error: %s', error.message)
      },
      reconnecting: () => {
        this.ctx.logger.warn('[deepseek-tag] reconnecting to Feishu/Lark')
      },
      reconnected: () => {
        this.ctx.logger.info('[deepseek-tag] reconnected to Feishu/Lark')
      },
    })
    try {
      await this.channel.connect()
      this.ctx.logger.info('[deepseek-tag] connected to %s', this.options.config.tenant)
    } catch (error) {
      this.unsubscribe()
      this.unsubscribe = undefined
      await this.channel.disconnect().catch(() => undefined)
      throw error
    }
  }

  /** Stop intake and drain active deliveries; every delivery owns its handle. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.channel.disconnect().catch(error => {
      this.ctx.logger.warn('[deepseek-tag] Lark disconnect failed: %s', messageOf(error))
    })
    await Promise.allSettled([...this.active])
  }

  private track(task: Promise<void>): Promise<void> {
    this.active.add(task)
    void task.finally(() => { this.active.delete(task) })
    return task
  }

  private async handleMessage(input: NormalizedMessage): Promise<void> {
    if (this.stopped) return
    let message = input
    try {
      message = await resolveTopicThread(input, this.channel.fetchRawMessage?.bind(this.channel))
      if (message.threadId !== input.threadId) {
        this.ctx.logger.info('[deepseek-tag] recovered topic thread id for message %s', input.messageId)
      }
    } catch (error) {
      this.ctx.logger.warn('[deepseek-tag] topic thread lookup failed for %s: %s', input.messageId, messageOf(error))
    }
    await this.queue.run(conversationScope(message), () => this.deliverMessage(message))
  }

  private async deliverMessage(message: NormalizedMessage): Promise<void> {
    if (this.stopped) return
    if (!this.admits(message)) return
    const scope = conversationScope(message)
    const sessionExists = this.persistedSessionIds.has(this.sessionIdForScope(scope))
    const history = supportsHistory(this.channel)
      ? new TagHistoryAccess(this.channel, message)
      : undefined
    let initialContext = ''
    if (!sessionExists && history !== undefined) {
      try {
        initialContext = renderInitialThreadContext(await history.initialThreadContext())
      } catch (error) {
        this.ctx.logger.warn('[deepseek-tag] initial thread history lookup failed: %s', messageOf(error))
      }
    }
    const content = this.promptFor(message, initialContext)
    if (content === undefined) {
      await this.safeReply(message, ATTACHMENT_NOTICE)
      return
    }
    const reaction = this.addWorkingReaction(message)
    let handle: AgentHandle | undefined
    let progress: ManagedRunCard | undefined
    let stopProjection: (() => void) | undefined
    let state: RunCardState = initialRunCardState
    try {
      handle = await this.activateConversation(message, history)
      const session = handle.agent.session
      const startSeq = session.events.length
      progress = await this.openProgressCard(message)
      if (progress !== undefined) {
        stopProjection = handle.agent.ctx.on('session/event', (subject, event) => {
          if (subject !== session || event.seq < startSeq) return
          state = reduceRunCardState(state, event)
          progress?.update(state)
        })
      }
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: content }],
        source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()
      const result = finalTurnResult(session.events.slice(startSeq))
      const text = result.kind === 'reply' ? result.text : result.kind === 'empty' ? EMPTY_RESPONSE : undefined
      state = finalizeRunCardState(state, text, result.kind === 'failed')
      if (progress !== undefined) {
        await progress.finish(state)
        if (!progress.healthy || runCardNeedsContinuation(state)) {
          await this.safeReply(message, text ?? FAILED_RESPONSE)
        }
      } else {
        await this.safeReply(message, text ?? FAILED_RESPONSE)
      }
    } catch (error) {
      this.ctx.logger.error('[deepseek-tag] message delivery failed: %s', messageOf(error))
      state = finalizeRunCardState(state, undefined, true)
      if (progress !== undefined) {
        await progress.finish(state)
        if (!progress.healthy) await this.safeReply(message, FAILED_RESPONSE)
      } else {
        await this.safeReply(message, FAILED_RESPONSE)
      }
    } finally {
      stopProjection?.()
      await this.removeWorkingReaction(message, reaction)
      await handle?.dispose().catch(error => {
        this.ctx.logger.warn('[deepseek-tag] agent runtime disposal failed: %s', messageOf(error))
      })
    }
  }

  private promptFor(message: NormalizedMessage, initialContext = ''): string | undefined {
    const text = message.content.trim()
    if (text.length === 0 && message.resources.length > 0) return undefined
    const body = text.length === 0 ? 'How can I help you?' : text
    const attachment = message.resources.length === 0 ? '' : `\n\n[${ATTACHMENT_NOTICE}]`
    const context = initialContext.length === 0 ? '' : `${initialContext}\n\n`
    if (message.chatType === 'p2p') return `${context}${body}${attachment}`
    const sender = message.senderName?.trim() || message.senderId
    return `${context}Lark group message from ${JSON.stringify(sender)}:\n${body}${attachment}`
  }

  private async activateConversation(
    message: NormalizedMessage,
    history: TagHistoryAccess | undefined,
  ): Promise<AgentHandle> {
    const scope = conversationScope(message)
    const { config } = this.options
    const place = conversationPlace(message, config)
    const actor = message.senderName?.trim() || message.senderId
    const sessionId = this.sessionIdForScope(scope)
    const memory = this.options.memory
    const setup = memory === undefined && history === undefined
      ? undefined
      : (agentCtx: Context): void => {
          memory?.install(agentCtx, place, actor)
          history?.install(agentCtx)
        }
    const options = {
      agentOptions: this.agentOptions,
      ...(setup === undefined ? {} : { setup }),
    }
    const handle = this.persistedSessionIds.has(sessionId)
      ? await this.ctx.agents.resume({ resumeSessionId: sessionId, ...options })
      : await this.ctx.agents.create({
        sessionId,
        meta: { cwd: config.cwd === '' ? process.cwd() : config.cwd },
        ...options,
      })
    this.persistedSessionIds.add(sessionId)
    return handle
  }

  /** Require an initial group mention, but let an owned thread continue freely. */
  private admits(message: NormalizedMessage): boolean {
    const sessionExists = this.persistedSessionIds.has(this.sessionIdForScope(conversationScope(message)))
    return admitsConversationMessage(message, this.options.config.requireMention, sessionExists)
  }

  private sessionIdForScope(scope: string): SessionId {
    return SessionId(createSessionId(scope, this.runtimeKey))
  }

  private async safeReply(message: NormalizedMessage, markdown: string): Promise<void> {
    try {
      await this.channel.reply(message, { markdown })
    } catch (error) {
      this.ctx.logger.error('[deepseek-tag] reply failed: %s', messageOf(error))
    }
  }

  private async openProgressCard(message: NormalizedMessage): Promise<ManagedRunCard | undefined> {
    const { createCard, send, updateCardById } = this.channel
    if (createCard === undefined || send === undefined || updateCardById === undefined) return undefined
    const managed: ManagedCardChannel = {
      createCard: createCard.bind(this.channel),
      send: send.bind(this.channel),
      updateCardById: updateCardById.bind(this.channel),
    }
    try {
      return await ManagedRunCard.open(managed, message, initialRunCardState, error => {
        this.ctx.logger.warn('[deepseek-tag] progress card update failed: %s', messageOf(error))
      })
    } catch (error) {
      this.ctx.logger.warn('[deepseek-tag] progress card unavailable; falling back to text: %s', messageOf(error))
      return undefined
    }
  }

  private addWorkingReaction(message: NormalizedMessage): Promise<string | undefined> {
    if (this.channel.addReaction === undefined) return Promise.resolve(undefined)
    return this.channel.addReaction(message.messageId, WORKING_REACTION).catch(error => {
      this.ctx.logger.warn('[deepseek-tag] working reaction failed: %s', messageOf(error))
      return undefined
    })
  }

  private async removeWorkingReaction(
    message: NormalizedMessage,
    reaction: Promise<string | undefined>,
  ): Promise<void> {
    const reactionId = await reaction
    if (reactionId === undefined || this.channel.removeReaction === undefined) return
    await this.channel.removeReaction(message.messageId, reactionId).catch(error => {
      this.ctx.logger.warn('[deepseek-tag] working reaction cleanup failed: %s', messageOf(error))
    })
  }
}
