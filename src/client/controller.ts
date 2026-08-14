/** Browser controller for the settings document and write-only app secret. */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import {
  createSnapshotStore,
  type SettingsScope,
  type SettingsScopeSnapshot,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_APP_SECRET_REF,
  WEB_SETTINGS_PATH,
  type DeepseekTagSettings,
  type LarkChatDirectoryView,
  type LarkGroupScopeSettings,
  type LarkPermissionView,
  type LarkSetupView,
} from '../contract.js'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const SETUP_SESSION_KEY = 'deepseek-tag.setup-session'

function rememberedSetupId(): string | undefined {
  try {
    return typeof sessionStorage === 'undefined'
      ? undefined
      : sessionStorage.getItem(SETUP_SESSION_KEY) ?? undefined
  } catch (_storageUnavailable) {
    return undefined
  }
}

function rememberSetupId(id: string | undefined): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    if (id === undefined) sessionStorage.removeItem(SETUP_SESSION_KEY)
    else sessionStorage.setItem(SETUP_SESSION_KEY, id)
  } catch (_storageUnavailable) {
    // Setup still works in-memory when browser storage is unavailable.
  }
}

/** Fully materialized form value supplied by the host schema defaults. */
export interface TagForm {
  enabled: boolean
  appId: string
  appSecretEnv: string
  tenant: 'feishu' | 'lark'
  dmMode: 'open' | 'allowlist' | 'disabled'
  dmAllowlist: string[]
  groupAllowlist: string[]
  workspaceMemoryGroups: string[]
  requireMention: boolean
  cwd: string
  provider: string
  model: string
  defaultInstructions: string
  groupScopes: LarkGroupScopeSettings[]
}

/** Safe credential facts rendered by the browser. */
export interface CredentialState {
  ref: string
  configured: boolean
  writable: boolean
  loading: boolean
}

/** Host-side registration progress with browser request state. */
export interface SetupState {
  loading: boolean
  value?: LarkSetupView
  error?: string
}

/** Permission preflight state; no credential values cross this boundary. */
export interface PermissionState extends LarkPermissionView {
  loading: boolean
}

/** Bot group directory state; entries never contain credentials. */
export interface ChatDirectoryState extends LarkChatDirectoryView {
  loading: boolean
}

/** One model route from Harness's live provider catalog. */
export interface ModelOption {
  provider: string
  model: string
  providerName: string
  modelName: string
}

export interface ModelCatalogState {
  loading: boolean
  options: ModelOption[]
  error?: string
}

/** Result of a staged form save. */
export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'credential' | 'settings' }

interface WebSettingsView {
  value: DeepseekTagSettings
  revision: number
  writable: boolean
}

interface WebSettingsResponse {
  ok: boolean
  value?: WebSettingsView
  setup?: LarkSetupView
  permissions?: LarkPermissionView
  chats?: LarkChatDirectoryView
  error?: string
}

/** Plugin-owned settings scope used because Harness does not expose third-party namespaces. */
export class WebTagSettingsScope implements SettingsScope<DeepseekTagSettings> {
  private readonly store: SnapshotStore<SettingsScopeSnapshot<DeepseekTagSettings>>

  constructor(loopback: boolean) {
    this.store = createSnapshotStore({
      status: loopback ? 'loading' : 'unavailable',
      value: undefined,
      base: undefined,
      user: undefined,
      revision: undefined,
      writable: false,
      mode: loopback ? 'host' : 'memory',
    })
    if (loopback) void this.load()
  }

  getSnapshot(): SettingsScopeSnapshot<DeepseekTagSettings> {
    return this.store.getSnapshot()
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  async load(): Promise<void> {
    await this.requestSettings({ operation: 'describe' })
  }

  async replace(value: DeepseekTagSettings, expectedRevision?: number): Promise<boolean> {
    return this.requestSettings({ operation: 'replace', value, expectedRevision })
  }

  async set(field: string, value: unknown): Promise<void> {
    await this.replace({ ...this.getSnapshot().value, [field]: value })
  }

  async unset(field: string): Promise<void> {
    const next = { ...this.getSnapshot().value }
    delete next[field as keyof DeepseekTagSettings]
    await this.replace(next)
  }

  async setupCreate(): Promise<LarkSetupView> {
    return this.requireSetup(await this.request({ operation: 'setup-create' }))
  }

  async setupAuthorize(): Promise<LarkSetupView> {
    return this.requireSetup(await this.request({ operation: 'setup-authorize' }))
  }

  async setupStatus(id: string): Promise<LarkSetupView> {
    return this.requireSetup(await this.request({ operation: 'setup-status', id }))
  }

  async setupFinish(id: string): Promise<void> {
    await this.request({ operation: 'setup-finish', id })
  }

  async setupCancel(id: string): Promise<void> {
    await this.request({ operation: 'setup-cancel', id })
  }

  async checkPermissions(): Promise<LarkPermissionView> {
    const response = await this.request({ operation: 'permissions-check' })
    if (response.permissions === undefined) throw new Error('permission status is unavailable')
    return response.permissions
  }

  async listChats(): Promise<LarkChatDirectoryView> {
    const response = await this.request({ operation: 'chats-list' })
    if (response.chats === undefined) throw new Error('Lark group directory is unavailable')
    return response.chats
  }

  private async requestSettings(body: object): Promise<boolean> {
    try {
      await this.request(body)
      return true
    } catch (_transportFailure) {
      return this.rejectInitialLoad()
    }
  }

  private async request(body: object): Promise<WebSettingsResponse> {
    const response = await fetch(WEB_SETTINGS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json() as WebSettingsResponse
    if (!response.ok || !payload.ok || payload.value === undefined) {
      throw new Error(payload.error ?? `request failed (${String(response.status)})`)
    }
    const view = payload.value
    this.store.set({
      status: 'ready',
      value: view.value,
      base: undefined,
      user: undefined,
      revision: view.revision,
      writable: view.writable,
      mode: 'host',
    })
    return payload
  }

  private requireSetup(response: WebSettingsResponse): LarkSetupView {
    if (response.setup === undefined) throw new Error('setup session is unavailable')
    return response.setup
  }

  private rejectInitialLoad(): false {
    const current = this.store.getSnapshot()
    if (current.status === 'loading') this.store.set({ ...current, status: 'unavailable' })
    return false
  }
}

/** Normalize a possibly partial value before it enters controlled inputs. */
export function formOf(value: DeepseekTagSettings | undefined): TagForm {
  return {
    enabled: value?.enabled ?? false,
    appId: value?.appId ?? '',
    appSecretEnv: value?.appSecretEnv ?? DEFAULT_APP_SECRET_REF,
    tenant: value?.tenant ?? 'feishu',
    dmMode: value?.dmMode ?? 'open',
    dmAllowlist: [...(value?.dmAllowlist ?? [])],
    groupAllowlist: [...(value?.groupAllowlist ?? [])],
    workspaceMemoryGroups: [...(value?.workspaceMemoryGroups ?? [])],
    requireMention: value?.requireMention ?? true,
    cwd: value?.cwd ?? '',
    provider: value?.provider ?? '',
    model: value?.model ?? '',
    defaultInstructions: value?.defaultInstructions ?? '',
    groupScopes: (value?.groupScopes ?? []).map(group => ({ ...group })),
  }
}

/** Client-side validation mirrors the host's constraints for immediate feedback. */
export function validateForm(form: TagForm): 'appId' | 'dmAllowlist' | 'modelRoute' | 'channelScopes' | undefined {
  if (form.enabled && !/^cli_[A-Za-z0-9]+$/.test(form.appId)) return 'appId'
  if (form.dmMode === 'allowlist' && form.dmAllowlist.length === 0) return 'dmAllowlist'
  if ((form.provider.trim() === '') !== (form.model.trim() === '')) return 'modelRoute'
  const chats = new Set<string>()
  for (const group of form.groupScopes) {
    if (group.chatId.trim() === ''
      || chats.has(group.chatId.trim())
      || ((group.provider?.trim() ?? '') === '') !== ((group.model?.trim() ?? '') === '')) return 'channelScopes'
    chats.add(group.chatId.trim())
  }
  return undefined
}

/** Own credential inspection and one atomic settings mutation. */
export class TagSettingsController {
  readonly credential: SnapshotStore<CredentialState>
  readonly setup: SnapshotStore<SetupState>
  readonly permissions: SnapshotStore<PermissionState>
  readonly chats: SnapshotStore<ChatDirectoryState>
  readonly models: SnapshotStore<ModelCatalogState>
  private chatRequest = 0

  constructor(
    private readonly scope: WebTagSettingsScope,
    private readonly api: Pick<IApiClient, 'credentials' | 'host' | 'llm'>,
  ) {
    this.credential = createSnapshotStore<CredentialState>({
      ref: DEFAULT_APP_SECRET_REF,
      configured: false,
      writable: true,
      loading: true,
    })
    this.setup = createSnapshotStore<SetupState>({ loading: false })
    this.permissions = createSnapshotStore<PermissionState>({
      loading: false,
      status: 'unconfigured',
      grantedScopes: [],
      missingScopes: [],
      capabilities: [],
    })
    this.chats = createSnapshotStore<ChatDirectoryState>({
      loading: false,
      status: 'unconfigured',
      chats: [],
    })
    this.models = createSnapshotStore<ModelCatalogState>({ loading: true, options: [] })
    scope.subscribe(() => {
      const ref = formOf(scope.getSnapshot().value).appSecretEnv
      if (ref !== this.credential.getSnapshot().ref) void this.refreshCredential(ref)
    })
    void this.refreshCredential()
    void this.refreshModels()
    void this.restoreSetup()
  }

  /** Start one-click app creation and return the platform URL to open. */
  async createApp(): Promise<LarkSetupView | undefined> {
    rememberSetupId(undefined)
    this.setup.set({ loading: true })
    try {
      const value = await this.scope.setupCreate()
      this.setup.set({ loading: false, value })
      rememberSetupId(value.id)
      return value
    } catch (error) {
      this.setup.set({ loading: false, error: messageOf(error) })
      return undefined
    }
  }

  /** Request missing scopes/events for the currently configured app. */
  async authorizeApp(): Promise<LarkSetupView | undefined> {
    rememberSetupId(undefined)
    this.setup.set({ loading: true })
    try {
      const value = await this.scope.setupAuthorize()
      this.setup.set({ loading: false, value })
      rememberSetupId(value.id)
      return value
    } catch (error) {
      this.setup.set({ loading: false, error: messageOf(error) })
      return undefined
    }
  }

  /** Poll the host-owned registration without exposing its credentials. */
  async pollSetup(): Promise<LarkSetupView | undefined> {
    const current = this.setup.getSnapshot().value
    if (current === undefined) return undefined
    try {
      const value = await this.scope.setupStatus(current.id)
      this.setup.set({ loading: false, value })
      if (value.kind === 'create' && value.status === 'ready') {
        await this.scope.setupFinish(value.id)
        await this.refreshCredential()
        await this.refreshPermissions()
        const { url: _url, ...rest } = value
        const completed: LarkSetupView = { ...rest, status: 'completed' }
        this.setup.set({ loading: false, value: completed })
        rememberSetupId(undefined)
        return completed
      }
      if (value.kind === 'authorize' && value.status === 'ready') {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await this.refreshPermissions()
          if (this.permissions.getSnapshot().status === 'ready') {
            const { url: _url, ...rest } = value
            this.setup.set({ loading: false, value: { ...rest, status: 'completed' } })
            break
          }
          if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1_500))
        }
        rememberSetupId(undefined)
      } else if (value.status === 'failed' || value.status === 'completed') {
        rememberSetupId(undefined)
      }
      return value
    } catch (error) {
      this.setup.set({ loading: false, value: current, error: messageOf(error) })
      return undefined
    }
  }

  async cancelSetup(): Promise<void> {
    const current = this.setup.getSnapshot().value
    if (current !== undefined) await this.scope.setupCancel(current.id).catch(() => undefined)
    rememberSetupId(undefined)
    this.setup.set({ loading: false })
  }

  private async restoreSetup(): Promise<void> {
    const id = rememberedSetupId()
    if (id === undefined) return
    this.setup.set({ loading: true })
    try {
      const value = await this.scope.setupStatus(id)
      this.setup.set({ loading: false, value })
      if (value.status === 'ready') await this.pollSetup()
      else if (value.status !== 'waiting') rememberSetupId(undefined)
    } catch (_expiredSession) {
      rememberSetupId(undefined)
      this.setup.set({ loading: false })
    }
  }

  /** Refresh app grants before the admin enables the bridge. */
  async refreshPermissions(): Promise<void> {
    const previous = this.permissions.getSnapshot()
    const { error: _error, ...rest } = previous
    this.permissions.set({ ...rest, loading: true })
    try {
      const value = await this.scope.checkPermissions()
      this.permissions.set({ ...value, loading: false })
    } catch (error) {
      this.permissions.set({
        loading: false,
        status: 'unknown',
        grantedScopes: [],
        missingScopes: [],
        capabilities: [],
        error: messageOf(error),
      })
    }
  }

  /** Discover groups the configured bot is currently a member of. */
  async refreshChats(): Promise<void> {
    const request = ++this.chatRequest
    const previous = this.chats.getSnapshot()
    const { error: _error, ...rest } = previous
    this.chats.set({ ...rest, loading: true })
    try {
      const value = await this.scope.listChats()
      if (request !== this.chatRequest) return
      this.chats.set({ ...value, loading: false })
    } catch (error) {
      if (request !== this.chatRequest) return
      this.chats.set({
        loading: false,
        status: 'unavailable',
        chats: [],
        error: messageOf(error),
      })
    }
  }

  /** Load the models the connected Harness runtime can actually route. */
  async refreshModels(): Promise<void> {
    this.models.set({ loading: true, options: [] })
    try {
      const response = await this.api.llm.models({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      const options = response.result.value.groups.flatMap(group => group.models.map(model => ({
        provider: group.id,
        model: model.id,
        providerName: group.name,
        modelName: model.name,
      })))
      this.models.set({ loading: false, options })
    } catch (error) {
      this.models.set({ loading: false, options: [], error: messageOf(error) })
    }
  }

  async pickDirectory(): Promise<string | null> {
    const response = await this.api.host.pickDirectory({})
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value.path
  }

  /** Refresh configured/writable facts without ever reading the value. */
  async refreshCredential(reference?: string): Promise<void> {
    const ref = reference ?? formOf(this.scope.getSnapshot().value).appSecretEnv
    const previous = this.credential.getSnapshot()
    this.credential.set({
      ref,
      configured: ref === previous.ref ? previous.configured : false,
      writable: ref === previous.ref ? previous.writable : true,
      loading: true,
    })
    if (ref !== previous.ref) {
      this.chatRequest += 1
      this.chats.set({ loading: false, status: 'unconfigured', chats: [] })
    }
    try {
      const response = await this.api.credentials.describe({ refs: [ref] })
      if (!response.result.ok || this.credential.getSnapshot().ref !== ref) return
      const view = response.result.value.credentials[ref]
      this.credential.set({
        ref,
        configured: view?.configured ?? false,
        writable: view?.writable ?? true,
        loading: false,
      })
      if (!(view?.configured ?? false)) {
        this.chatRequest += 1
        this.chats.set({ loading: false, status: 'unconfigured', chats: [] })
      }
    } catch (_credentialReadFailure) {
      if (this.credential.getSnapshot().ref === ref) {
        this.credential.set({ ...this.credential.getSnapshot(), loading: false })
      }
    }
  }

  /** Store a new secret if supplied, then atomically mutate the visible form fields. */
  async save(form: TagForm, appSecret: string): Promise<SaveResult> {
    const secret = appSecret.trim()
    if (secret.length > 0) {
      try {
        const response = await this.api.credentials.set({ ref: form.appSecretEnv, value: secret })
        if (!response.result.ok) return { ok: false, reason: 'credential' }
      } catch (_credentialWriteFailure) {
        return { ok: false, reason: 'credential' }
      }
      await this.refreshCredential(form.appSecretEnv)
    }
    if (form.enabled && !this.credential.getSnapshot().configured) {
      return { ok: false, reason: 'credential' }
    }

    const snapshot = this.scope.getSnapshot()
    const previous = formOf(snapshot.value)
    const appChanged = secret.length > 0
      || form.appId.trim() !== previous.appId
      || form.tenant !== previous.tenant
    const section: TagForm = {
      ...form,
      enabled: appChanged ? false : form.enabled,
      appId: form.appId.trim(),
      cwd: form.cwd.trim(),
      provider: form.provider.trim(),
      model: form.model.trim(),
      dmAllowlist: [...form.dmAllowlist],
      groupAllowlist: [...form.groupAllowlist],
      workspaceMemoryGroups: [...form.workspaceMemoryGroups],
      groupScopes: form.groupScopes.map(group => ({ ...group })),
    }
    try {
      const saved = await this.scope.replace(section, snapshot.revision)
      return saved ? { ok: true } : { ok: false, reason: 'settings' }
    } catch (_settingsWriteFailure) {
      return { ok: false, reason: 'settings' }
    }
  }
}
