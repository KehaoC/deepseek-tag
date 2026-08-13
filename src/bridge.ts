/** Feishu/Lark channel to DeepSeek Harness agent bridge. */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  createLarkChannel,
  type LarkChannel,
  type LarkChannelError,
  type NormalizedMessage,
} from '@larksuite/channel'
import type { ResolvedConfig } from './config.js'
import { finalTurnResult } from './response.js'
import { conversationScope, createSessionId } from './scope.js'

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
}

/** Bridge construction seams. */
export interface BridgeOptions {
  config: ResolvedConfig
  appSecret: string
  createChannel?: (config: ResolvedConfig, appSecret: string) => ChannelLike
}

interface ConversationSession {
  readonly handle: AgentHandle
}

const ATTACHMENT_NOTICE = 'This version of Deepseek Tag can read text only; attachments in this message were not included.'
const EMPTY_RESPONSE = 'The agent finished without a text response.'
const FAILED_RESPONSE = 'I couldn\'t finish that request. Please try again or check the DeepSeek Harness logs.'

/** Stable error text for logs regardless of the thrown shape. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
      requireMention: config.requireMention,
      respondToMentionAll: false,
    },
    safety: {
      chatQueue: { enabled: true, mergeWhileBusy: false },
    },
    keepalive: { enabled: true },
    wsConfig: { pingTimeout: 3 },
    handshakeTimeoutMs: 8_000,
    httpTimeoutMs: 30_000,
    respectProxyEnv: true,
  })
}

/**
 * Own one channel connection and the Harness agents created for its
 * conversations. Message handlers wait for their turn to finish so the SDK's
 * per-chat queue keeps reply targets ordered.
 */
export class DeepseekTagBridge {
  private readonly channel: ChannelLike
  private readonly conversations = new Map<string, Promise<ConversationSession>>()
  private readonly active = new Set<Promise<void>>()
  private unsubscribe: (() => void) | undefined
  private stopped = false

  constructor(private readonly ctx: Context, private readonly options: BridgeOptions) {
    this.channel = (options.createChannel ?? productionChannel)(options.config, options.appSecret)
  }

  /** Subscribe before connecting so no first message is missed. */
  async start(): Promise<void> {
    if (this.unsubscribe !== undefined) return
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

  /** Stop intake, drain active deliveries, then dispose every owned agent. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.channel.disconnect().catch(error => {
      this.ctx.logger.warn('[deepseek-tag] Lark disconnect failed: %s', messageOf(error))
    })
    await Promise.allSettled([...this.active])
    const sessions = await Promise.allSettled([...this.conversations.values()])
    this.conversations.clear()
    await Promise.allSettled(sessions.flatMap(result =>
      result.status === 'fulfilled' ? [result.value.handle.dispose()] : [],
    ))
  }

  private track(task: Promise<void>): Promise<void> {
    this.active.add(task)
    void task.finally(() => { this.active.delete(task) })
    return task
  }

  private async handleMessage(message: NormalizedMessage): Promise<void> {
    if (this.stopped) return
    const content = this.promptFor(message)
    if (content === undefined) {
      await this.safeReply(message, ATTACHMENT_NOTICE)
      return
    }
    try {
      const conversation = await this.conversationFor(message)
      const session = conversation.handle.agent.session
      const startSeq = session.events.length
      conversation.handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: content }],
        source: { kind: 'user' },
      }))
      await conversation.handle.agent.whenIdle()
      const result = finalTurnResult(session.events.slice(startSeq))
      await this.safeReply(
        message,
        result.kind === 'reply' ? result.text : result.kind === 'empty' ? EMPTY_RESPONSE : FAILED_RESPONSE,
      )
    } catch (error) {
      this.ctx.logger.error('[deepseek-tag] message delivery failed: %s', messageOf(error))
      await this.safeReply(message, FAILED_RESPONSE)
    }
  }

  private promptFor(message: NormalizedMessage): string | undefined {
    const text = message.content.trim()
    if (text.length === 0 && message.resources.length > 0) return undefined
    const body = text.length === 0 ? 'How can I help you?' : text
    const attachment = message.resources.length === 0 ? '' : `\n\n[${ATTACHMENT_NOTICE}]`
    if (message.chatType === 'p2p') return `${body}${attachment}`
    const sender = message.senderName?.trim() || message.senderId
    return `Lark group message from ${JSON.stringify(sender)}:\n${body}${attachment}`
  }

  private conversationFor(message: NormalizedMessage): Promise<ConversationSession> {
    const scope = conversationScope(message)
    const existing = this.conversations.get(scope)
    if (existing !== undefined) return existing
    const created = this.createConversation(scope)
    this.conversations.set(scope, created)
    void created.catch(() => { this.conversations.delete(scope) })
    return created
  }

  private async createConversation(scope: string): Promise<ConversationSession> {
    const { config } = this.options
    const agentOptions: AgentOptions = {
      ...(config.provider === '' ? {} : { provider: config.provider }),
      ...(config.model === '' ? {} : { model: config.model }),
    }
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(createSessionId(scope)),
      meta: { cwd: config.cwd === '' ? process.cwd() : config.cwd },
      ...(Object.keys(agentOptions).length === 0 ? {} : { agentOptions }),
    })
    return { handle }
  }

  private async safeReply(message: NormalizedMessage, markdown: string): Promise<void> {
    try {
      await this.channel.reply(message, { markdown })
    } catch (error) {
      this.ctx.logger.error('[deepseek-tag] reply failed: %s', messageOf(error))
    }
  }
}
