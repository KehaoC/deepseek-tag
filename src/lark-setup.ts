/** Short-lived Lark app creation and incremental authorization sessions. */

import { randomUUID } from 'node:crypto'
import { clearTimeout, setTimeout } from 'node:timers'
import {
  createLarkChannel,
  registerApp,
  type LarkChannel,
  type RegisterAppOptions,
  type RegisterAppResult,
} from '@larksuite/channel'
import type {
  LarkPermissionView,
  LarkSetupKind,
  LarkSetupView,
  LarkTenant,
} from './contract.js'

/** Permissions used by transport delivery, replies, and scoped history tools. */
export const REQUIRED_LARK_SCOPES = [
  'application:application:self_manage',
  'im:message:readonly',
  'im:message:send_as_bot',
  'im:message.p2p_msg:readonly',
  'im:message.group_msg',
  'im:chat:read',
  'im:chat.members:read',
] as const

const RECOGNIZED_LARK_SCOPES = [
  ...REQUIRED_LARK_SCOPES,
  'im:message',
  'im:message.p2p_msg',
  'im:chat',
  'im:chat:readonly',
] as const

/** Event required by the channel SDK's WebSocket transport. */
export const REQUIRED_LARK_EVENTS = ['im.message.receive_v1'] as const

/** Result retained only inside the host until credentials are durably stored. */
export interface PendingLarkRegistration {
  appId: string
  appSecret: string
  tenant: LarkTenant
}

interface SetupSession {
  view: LarkSetupView
  abort: AbortController
  registration: PendingLarkRegistration | undefined
  expiry: ReturnType<typeof setTimeout> | undefined
}

type Register = (options: RegisterAppOptions) => Promise<RegisterAppResult>

const SESSION_RETENTION_MS = 5 * 60_000

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const description = (error as { description?: unknown }).description
    if (typeof description === 'string') return description
  }
  return String(error)
}

function registrationOptions(): Pick<RegisterAppOptions, 'appPreset' | 'addons' | 'source'> {
  return {
    source: 'deepseek-tag',
    appPreset: {
      name: 'Deepseek Tag',
      desc: 'Connect Feishu or Lark conversations to a DeepSeek Harness agent.',
    },
    addons: {
      scopes: { tenant: [...REQUIRED_LARK_SCOPES] },
      events: { items: { tenant: [...REQUIRED_LARK_EVENTS] } },
    },
  }
}

/** Own registration polling, expiry, cancellation, and in-memory secrets. */
export class LarkSetupManager {
  private readonly sessions = new Map<string, SetupSession>()

  constructor(private readonly register: Register = registerApp) {}

  /** Begin an app-creation flow and resolve as soon as its browser URL exists. */
  startCreate(): Promise<LarkSetupView> {
    return this.start('create')
  }

  /** Begin additive authorization for an existing application. */
  startAuthorization(appId: string): Promise<LarkSetupView> {
    if (!/^cli_[A-Za-z0-9]+$/.test(appId)) throw new Error('a valid Lark App ID is required')
    return this.start('authorize', appId)
  }

  /** Read a secret-free snapshot. */
  describe(id: string): LarkSetupView {
    const session = this.sessions.get(id)
    if (session === undefined) throw new Error('setup session not found or expired')
    return { ...session.view }
  }

  /** Read the registration result without consuming it, so a failed store can retry. */
  registration(id: string): PendingLarkRegistration {
    const session = this.sessions.get(id)
    if (session?.view.kind !== 'create' || session.view.status !== 'ready'
      || session.registration === undefined) {
      throw new Error('app registration is not ready')
    }
    return { ...session.registration }
  }

  /** Clear the retained secret only after the host has persisted it. */
  complete(id: string): LarkSetupView {
    const session = this.sessions.get(id)
    if (session === undefined || session.view.status !== 'ready') {
      throw new Error('setup session is not ready')
    }
    session.registration = undefined
    const { url: _url, ...rest } = session.view
    session.view = { ...rest, status: 'completed' }
    this.retainThenDelete(session)
    return { ...session.view }
  }

  /** Abort one unfinished poll and erase any retained credentials. */
  cancel(id: string): void {
    const session = this.sessions.get(id)
    if (session === undefined) return
    session.abort.abort()
    if (session.expiry !== undefined) clearTimeout(session.expiry)
    session.registration = undefined
    this.sessions.delete(id)
  }

  /** Dispose every registration poll when the plugin fiber stops. */
  close(): void {
    for (const id of [...this.sessions.keys()]) this.cancel(id)
  }

  private start(kind: LarkSetupKind, appId?: string): Promise<LarkSetupView> {
    for (const [id, existing] of this.sessions) {
      if (existing.view.kind === kind && existing.view.status === 'waiting') this.cancel(id)
    }
    const id = randomUUID()
    const session: SetupSession = {
      view: { id, kind, status: 'waiting', ...(appId === undefined ? {} : { appId }) },
      abort: new AbortController(),
      registration: undefined,
      expiry: undefined,
    }
    this.sessions.set(id, session)

    return new Promise<LarkSetupView>((resolve, reject) => {
      let urlDelivered = false
      const common: RegisterAppOptions = {
        ...registrationOptions(),
        signal: session.abort.signal,
        onQRCodeReady: ({ url, expireIn }) => {
          urlDelivered = true
          session.view = {
            ...session.view,
            url,
            expiresAt: Date.now() + expireIn * 1000,
          }
          resolve({ ...session.view })
        },
      }
      const options: RegisterAppOptions = kind === 'create'
        ? { ...common, createOnly: true }
        : { ...common, appId: appId! }
      void this.register(options).then(result => {
        if (!this.sessions.has(id)) return
        const tenant = result.user_info?.tenant_brand ?? 'feishu'
        session.view = {
          ...session.view,
          status: 'ready',
          appId: result.client_id,
          tenant,
        }
        if (kind === 'create') {
          session.registration = {
            appId: result.client_id,
            appSecret: result.client_secret,
            tenant,
          }
        } else {
          this.retainThenDelete(session)
        }
      }).catch(error => {
        if (!this.sessions.has(id)) return
        session.registration = undefined
        const { url: _url, ...rest } = session.view
        session.view = {
          ...rest,
          status: 'failed',
          error: errorMessage(error),
        }
        this.retainThenDelete(session)
        if (!urlDelivered) reject(error)
      })
    })
  }

  private retainThenDelete(session: SetupSession): void {
    if (session.expiry !== undefined) clearTimeout(session.expiry)
    session.expiry = setTimeout(() => {
      session.registration = undefined
      this.sessions.delete(session.view.id)
    }, SESSION_RETENTION_MS)
    session.expiry.unref()
  }
}

type PermissionChannel = Pick<LarkChannel, 'rawClient'>
type ChannelFactory = typeof createLarkChannel

/** Check actual tenant grants without exposing credentials or raw API data. */
export async function inspectLarkPermissions(
  input: { appId: string; appSecret: string; tenant: LarkTenant },
  createChannel: ChannelFactory = createLarkChannel,
): Promise<LarkPermissionView> {
  try {
    const channel: PermissionChannel = createChannel({
      appId: input.appId,
      appSecret: input.appSecret,
      domain: input.tenant === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn',
      source: 'deepseek-tag-setup',
      httpTimeoutMs: 15_000,
      respectProxyEnv: true,
    })
    const response = await channel.rawClient.application.application.get({
      params: { lang: input.tenant === 'lark' ? 'en_us' : 'zh_cn', user_id_type: 'open_id' },
      path: { app_id: input.appId },
    })
    const actualScopes = new Set((response.data?.app?.scopes ?? []).map(scope => scope.scope))
    const messageRead = actualScopes.has('im:message') || actualScopes.has('im:message:readonly')
    const messageSend = actualScopes.has('im:message') || actualScopes.has('im:message:send_as_bot')
    const directMessages = actualScopes.has('im:message')
      || actualScopes.has('im:message.p2p_msg')
      || actualScopes.has('im:message.p2p_msg:readonly')
    const groupHistory = actualScopes.has('im:message.group_msg')
    const chatRead = actualScopes.has('im:chat')
      || actualScopes.has('im:chat:readonly')
      || actualScopes.has('im:chat:read')
    const chatMembers = actualScopes.has('im:chat')
      || actualScopes.has('im:chat:readonly')
      || actualScopes.has('im:chat.members:read')
    const capabilities: LarkPermissionView['capabilities'] = [
      'appInspection',
      ...(messageRead && messageSend ? ['messages' as const] : []),
      ...(directMessages ? ['directMessages' as const] : []),
      ...(groupHistory ? ['groupHistory' as const] : []),
      ...(chatRead && chatMembers ? ['chatContext' as const] : []),
    ]
    const missingScopes = [
      ...(!messageRead ? ['im:message:readonly'] : []),
      ...(!messageSend ? ['im:message:send_as_bot'] : []),
      ...(!directMessages ? ['im:message.p2p_msg:readonly'] : []),
      ...(!groupHistory ? ['im:message.group_msg'] : []),
      ...(!chatRead ? ['im:chat:read'] : []),
      ...(!chatMembers ? ['im:chat.members:read'] : []),
    ]
    return {
      status: missingScopes.length === 0 ? 'ready' : 'missing',
      grantedScopes: RECOGNIZED_LARK_SCOPES.filter(scope => actualScopes.has(scope)),
      missingScopes,
      capabilities,
    }
  } catch (error) {
    return {
      status: 'unknown',
      grantedScopes: [],
      missingScopes: [...REQUIRED_LARK_SCOPES],
      capabilities: [],
      error: errorMessage(error),
    }
  }
}
