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

  private async handleMessage(message: NormalizedMessage): Promise<void> {
    if (this.stopped) return
    const content = this.promptFor(message)
    if (content === undefined) {
      await this.safeReply(message, ATTACHMENT_NOTICE)
      return
    }
    let handle: AgentHandle | undefined
    try {
      handle = await this.activateConversation(message)
      const session = handle.agent.session
      const startSeq = session.events.length
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: content }],
        source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()
      const result = finalTurnResult(session.events.slice(startSeq))
      await this.safeReply(
        message,
        result.kind === 'reply' ? result.text : result.kind === 'empty' ? EMPTY_RESPONSE : FAILED_RESPONSE,
      )
    } catch (error) {
      this.ctx.logger.error('[deepseek-tag] message delivery failed: %s', messageOf(error))
      await this.safeReply(message, FAILED_RESPONSE)
    } finally {
      await handle?.dispose().catch(error => {
        this.ctx.logger.warn('[deepseek-tag] agent runtime disposal failed: %s', messageOf(error))
      })
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

  private async activateConversation(message: NormalizedMessage): Promise<AgentHandle> {
    const scope = conversationScope(message)
    const { config } = this.options
    const sessionId = SessionId(createSessionId(scope, this.runtimeKey))
    const options = { agentOptions: this.agentOptions }
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

  private async safeReply(message: NormalizedMessage, markdown: string): Promise<void> {
    try {
      await this.channel.reply(message, { markdown })
    } catch (error) {
      this.ctx.logger.error('[deepseek-tag] reply failed: %s', messageOf(error))
    }
  }
}
