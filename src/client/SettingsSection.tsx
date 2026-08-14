/** Dedicated Web settings page for Deepseek Tag. */

import { useEffect, useState } from 'react'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DeepseekTagSettings } from '../contract.js'
import {
  formOf,
  validateForm,
  type CredentialState,
  type SaveResult,
  type TagForm,
} from './controller.js'
import type { LOCALE_NAMESPACE } from './locales.js'

/** Business face injected by the slot registration. */
export interface TagSettingsInjected {
  hooks: {
    tagSettings: SettingsScope<DeepseekTagSettings>
    credential: SnapshotStore<CredentialState>
  }
  save(form: TagForm, appSecret: string): Promise<SaveResult>
}

/** Props bound by the Harness settings renderer. */
export type TagSettingsProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof LOCALE_NAMESPACE>
  & InjectFace<TagSettingsInjected>

function listOf(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))]
}

/** Render a staged, single-save configuration form. */
export function TagSettingsSection(props: TagSettingsProps) {
  const snapshot = props.useTagSettings(value => value)
  const credential = props.useCredential(value => value)
  const [form, setForm] = useState<TagForm>(() => formOf(snapshot.value))
  const [secret, setSecret] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<'saved' | 'credential' | 'settings'>()
  const { t } = props

  useEffect(() => {
    setForm(formOf(snapshot.value))
    setDirty(false)
  }, [snapshot.revision, snapshot.value])

  const patch = (next: Partial<TagForm>): void => {
    setForm(current => ({ ...current, ...next }))
    setDirty(true)
    setResult(undefined)
  }
  const save = async (): Promise<void> => {
    setSaving(true)
    setResult(undefined)
    const saved = await props.save(form, secret)
    setSaving(false)
    if (!saved.ok) {
      setResult(saved.reason)
      return
    }
    setSecret('')
    setDirty(false)
    setResult('saved')
  }
  const validation = validateForm(form)

  if (snapshot.status === 'loading') return <p className="dst-hint">{t('statusLoading')}</p>
  if (snapshot.status !== 'ready') return <p className="dst-error">{t('unavailable')}</p>

  return (
    <section className="dst-section">
      <div className="dst-field">
        <h2>{t('title')}</h2>
        <p className="dst-intro">{t('intro')}</p>
      </div>

      <div className="dst-status">
        <span className={`dst-badge${credential.configured ? ' dst-badge--ok' : ''}`}>
          {credential.configured ? t('statusSecretSet') : t('statusSecretUnset')}
        </span>
      </div>

      <div className="dst-card dst-card--primary">
        <label className="dst-toggle">
          <input
            type="checkbox"
            checked={form.enabled}
            disabled={!snapshot.writable}
            onChange={event => { patch({ enabled: event.target.checked }) }}
          />
          <span>{t('enabled')}</span>
        </label>
        <p className="dst-hint">{t('enabledHint')}</p>
      </div>

      <div className="dst-card">
        <h3>{t('app')}</h3>
        <div className="dst-row">
          <div className="dst-field">
            <label htmlFor="dst-app-id">{t('appId')}</label>
            <span className="dst-hint">{t('appIdHint')}</span>
          </div>
          <input
            id="dst-app-id"
            className="dst-input"
            value={form.appId}
            disabled={!snapshot.writable}
            autoComplete="off"
            onChange={event => { patch({ appId: event.target.value }) }}
          />
        </div>
        <div className="dst-row">
          <div className="dst-field">
            <label htmlFor="dst-app-secret">{t('appSecret')}</label>
            <span className="dst-hint">{t('appSecretHint')}</span>
          </div>
          <input
            id="dst-app-secret"
            className="dst-input"
            type="password"
            value={secret}
            disabled={!credential.writable}
            autoComplete="new-password"
            onChange={event => {
              setSecret(event.target.value)
              setDirty(true)
              setResult(undefined)
            }}
          />
        </div>
        <div className="dst-row">
          <label htmlFor="dst-tenant">{t('tenant')}</label>
          <select
            id="dst-tenant"
            className="dst-select"
            value={form.tenant}
            disabled={!snapshot.writable}
            onChange={event => { patch({ tenant: event.target.value === 'lark' ? 'lark' : 'feishu' }) }}
          >
            <option value="feishu">{t('tenantFeishu')}</option>
            <option value="lark">{t('tenantLark')}</option>
          </select>
        </div>
      </div>

      <div className="dst-card">
        <h3>{t('access')}</h3>
        <div className="dst-row">
          <label htmlFor="dst-dm-mode">{t('dmMode')}</label>
          <select
            id="dst-dm-mode"
            className="dst-select"
            value={form.dmMode}
            disabled={!snapshot.writable}
            onChange={event => {
              const value = event.target.value
              patch({ dmMode: value === 'allowlist' || value === 'disabled' ? value : 'open' })
            }}
          >
            <option value="open">{t('dmOpen')}</option>
            <option value="allowlist">{t('dmAllowlist')}</option>
            <option value="disabled">{t('dmDisabled')}</option>
          </select>
        </div>
        {form.dmMode === 'allowlist' ? (
          <div className="dst-row">
            <div className="dst-field">
              <label htmlFor="dst-dm-list">{t('dmAllowlistLabel')}</label>
              <span className="dst-hint">{t('dmAllowlistHint')}</span>
            </div>
            <textarea
              id="dst-dm-list"
              className="dst-textarea"
              value={form.dmAllowlist.join('\n')}
              disabled={!snapshot.writable}
              onChange={event => { patch({ dmAllowlist: listOf(event.target.value) }) }}
            />
          </div>
        ) : null}
        <div className="dst-row">
          <div className="dst-field">
            <label htmlFor="dst-group-list">{t('groupAllowlist')}</label>
            <span className="dst-hint">{t('groupAllowlistHint')}</span>
          </div>
          <textarea
            id="dst-group-list"
            className="dst-textarea"
            value={form.groupAllowlist.join('\n')}
            disabled={!snapshot.writable}
            onChange={event => { patch({ groupAllowlist: listOf(event.target.value) }) }}
          />
        </div>
        <label className="dst-toggle">
          <input
            type="checkbox"
            checked={form.requireMention}
            disabled={!snapshot.writable}
            onChange={event => { patch({ requireMention: event.target.checked }) }}
          />
          <span>{t('requireMention')}</span>
        </label>
      </div>

      <div className="dst-card">
        <h3>{t('agent')}</h3>
        {([
          ['cwd', 'cwd', 'cwdHint'],
          ['provider', 'provider', 'providerHint'],
          ['model', 'model', 'modelHint'],
        ] as const).map(([field, label, hint]) => (
          <div className="dst-row" key={field}>
            <div className="dst-field">
              <label htmlFor={`dst-${field}`}>{t(label)}</label>
              <span className="dst-hint">{t(hint)}</span>
            </div>
            <input
              id={`dst-${field}`}
              className="dst-input"
              value={form[field]}
              disabled={!snapshot.writable}
              onChange={event => { patch({ [field]: event.target.value }) }}
            />
          </div>
        ))}
      </div>

      {validation === 'appId' ? <p className="dst-error">{t('invalidAppId')}</p> : null}
      {validation === 'dmAllowlist' ? <p className="dst-error">{t('invalidAllowlist')}</p> : null}
      {validation === 'modelRoute' ? <p className="dst-error">{t('invalidModelRoute')}</p> : null}
      {result === 'credential' ? <p className="dst-error">{t('credentialFailed')}</p> : null}
      {result === 'settings' && validation === undefined
        ? <p className="dst-error">{t('settingsFailed')}</p>
        : null}
      {result === 'saved' ? <p className="dst-success">{t('saved')}</p> : null}
      <div className="dst-actions">
        <button
          className="dst-button"
          type="button"
          disabled={!snapshot.writable || !dirty || saving || validation !== undefined}
          onClick={() => { void save() }}
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </section>
  )
}
