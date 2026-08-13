/** Browser controller for the settings document and write-only app secret. */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import {
  createSnapshotStore,
  type SettingsScope,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_APP_SECRET_REF,
  SETTINGS_NAMESPACE,
  type DeepseekTagSettings,
} from '../contract.js'

/** Fully materialized form value supplied by the host schema defaults. */
export interface TagForm {
  enabled: boolean
  appId: string
  appSecretEnv: string
  tenant: 'feishu' | 'lark'
  dmMode: 'open' | 'allowlist' | 'disabled'
  dmAllowlist: string[]
  groupAllowlist: string[]
  requireMention: boolean
  cwd: string
  provider: string
  model: string
}

/** Safe credential facts rendered by the browser. */
export interface CredentialState {
  ref: string
  configured: boolean
  writable: boolean
  loading: boolean
}

/** Result of a staged form save. */
export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'credential' | 'settings' }

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
    requireMention: value?.requireMention ?? true,
    cwd: value?.cwd ?? '',
    provider: value?.provider ?? '',
    model: value?.model ?? '',
  }
}

/** Client-side validation mirrors the host's constraints for immediate feedback. */
export function validateForm(form: TagForm): 'appId' | 'dmAllowlist' | undefined {
  if (form.enabled && !/^cli_[A-Za-z0-9]+$/.test(form.appId)) return 'appId'
  if (form.dmMode === 'allowlist' && form.dmAllowlist.length === 0) return 'dmAllowlist'
  return undefined
}

/** Own credential inspection and one atomic settings mutation. */
export class TagSettingsController {
  readonly credential: SnapshotStore<CredentialState>

  constructor(
    private readonly scope: SettingsScope<DeepseekTagSettings>,
    private readonly api: Pick<IApiClient, 'credentials' | 'settings'>,
  ) {
    this.credential = createSnapshotStore<CredentialState>({
      ref: DEFAULT_APP_SECRET_REF,
      configured: false,
      writable: true,
      loading: true,
    })
    scope.subscribe(() => {
      const ref = formOf(scope.getSnapshot().value).appSecretEnv
      if (ref !== this.credential.getSnapshot().ref) void this.refreshCredential(ref)
    })
    void this.refreshCredential()
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

    const section: TagForm = {
      ...form,
      appId: form.appId.trim(),
      cwd: form.cwd.trim(),
      provider: form.provider.trim(),
      model: form.model.trim(),
      dmAllowlist: [...form.dmAllowlist],
      groupAllowlist: [...form.groupAllowlist],
    }
    const snapshot = this.scope.getSnapshot()
    try {
      const response = await this.api.settings.mutate({
        ns: SETTINGS_NAMESPACE,
        ops: Object.entries(section).map(([field, value]) => ({
          op: 'set' as const,
          path: [field],
          value,
        })),
        ...(snapshot.revision === undefined ? {} : { expectedRevision: snapshot.revision }),
      })
      return response.result.ok ? { ok: true } : { ok: false, reason: 'settings' }
    } catch (_settingsWriteFailure) {
      return { ok: false, reason: 'settings' }
    }
  }
}
