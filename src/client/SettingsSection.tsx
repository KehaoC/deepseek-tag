/** Guided Deepseek Tag setup and ongoing configuration page. */

import { useEffect, useMemo, useState } from 'react'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DeepseekTagSettings, LarkSetupView } from '../contract.js'
import {
  formOf,
  validateForm,
  type CredentialState,
  type ModelCatalogState,
  type PermissionState,
  type SaveResult,
  type SetupState,
  type TagForm,
} from './controller.js'
import type { LOCALE_NAMESPACE } from './locales.js'

const PERMISSION_BUNDLE = [
  {
    capability: 'appInspection',
    codes: 'application:application:self_manage',
    label: 'permissionAppInspection',
  },
  {
    capability: 'messages',
    codes: 'im:message:readonly + im:message:send_as_bot',
    label: 'permissionMessages',
  },
  {
    capability: 'directMessages',
    codes: 'im:message.p2p_msg:readonly',
    label: 'permissionDirectMessages',
  },
  {
    capability: 'groupHistory',
    codes: 'im:message.group_msg',
    label: 'permissionGroupHistory',
  },
  {
    capability: 'chatContext',
    codes: 'im:chat:read + im:chat.members:read',
    label: 'permissionChatContext',
  },
] as const

export interface TagSettingsInjected {
  hooks: {
    tagSettings: SettingsScope<DeepseekTagSettings>
    credential: SnapshotStore<CredentialState>
    setup: SnapshotStore<SetupState>
    permissions: SnapshotStore<PermissionState>
    models: SnapshotStore<ModelCatalogState>
  }
  save(form: TagForm, appSecret: string): Promise<SaveResult>
  createApp(): Promise<LarkSetupView | undefined>
  authorizeApp(): Promise<LarkSetupView | undefined>
  pollSetup(): Promise<LarkSetupView | undefined>
  cancelSetup(): Promise<void>
  refreshPermissions(): Promise<void>
  pickDirectory(): Promise<string | null>
}

export type TagSettingsProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<typeof LOCALE_NAMESPACE>
  & InjectFace<TagSettingsInjected>

function listOf(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))]
}

function routeValue(provider: string, model: string): string {
  return provider === '' && model === '' ? '' : JSON.stringify([provider, model])
}

function openPendingPage(): Window | null {
  const popup = window.open('about:blank', '_blank')
  if (popup !== null) popup.opener = null
  return popup
}

export function TagSettingsSection(props: TagSettingsProps) {
  const snapshot = props.useTagSettings(value => value)
  const credential = props.useCredential(value => value)
  const setup = props.useSetup(value => value)
  const permissions = props.usePermissions(value => value)
  const models = props.useModels(value => value)
  const [form, setForm] = useState<TagForm>(() => formOf(snapshot.value))
  const [secret, setSecret] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<'saved' | 'credential' | 'settings'>()
  const [groupMode, setGroupMode] = useState<'all' | 'specific'>(() => (
    form.groupAllowlist.length > 0 ? 'specific' : 'all'
  ))
  const [directoryError, setDirectoryError] = useState(false)
  const { t } = props

  useEffect(() => {
    const next = formOf(snapshot.value)
    setForm(next)
    setGroupMode(next.groupAllowlist.length > 0 ? 'specific' : 'all')
    setDirty(false)
  }, [snapshot.revision, snapshot.value])

  useEffect(() => {
    if (credential.configured && form.appId !== '') void props.refreshPermissions()
  }, [credential.configured, form.appId, snapshot.revision])

  useEffect(() => {
    if (setup.value?.status !== 'waiting') return
    const timer = window.setInterval(() => { void props.pollSetup() }, 1500)
    return () => { window.clearInterval(timer) }
  }, [setup.value?.id, setup.value?.status])

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

  const beginSetup = async (kind: 'create' | 'authorize'): Promise<void> => {
    const popup = openPendingPage()
    const value = kind === 'create' ? await props.createApp() : await props.authorizeApp()
    if (value?.url !== undefined) popup?.location.replace(value.url)
    else popup?.close()
  }

  const chooseDirectory = async (): Promise<void> => {
    setDirectoryError(false)
    try {
      const path = await props.pickDirectory()
      if (path !== null) patch({ cwd: path })
    } catch (_error) {
      setDirectoryError(true)
    }
  }

  const modelGroups = useMemo(() => {
    const groups = new Map<string, typeof models.options>()
    for (const option of models.options) {
      const list = groups.get(option.providerName) ?? []
      list.push(option)
      groups.set(option.providerName, list)
    }
    return [...groups]
  }, [models.options])

  const currentRoute = routeValue(form.provider, form.model)
  const currentListed = currentRoute === '' || models.options.some(option => (
    option.provider === form.provider && option.model === form.model
  ))
  const savedForm = formOf(snapshot.value)
  const paired = savedForm.appId !== '' && credential.configured
  const appMatchesSaved = form.appId === savedForm.appId && form.tenant === savedForm.tenant
  const permissionsReady = permissions.status === 'ready'
  const canLaunch = paired && appMatchesSaved && permissionsReady
  const validation = validateForm(form)
  const invalidGroupScope = groupMode === 'specific' && form.groupAllowlist.length === 0

  if (snapshot.status === 'loading') return <p className="dst-hint">{t('statusLoading')}</p>
  if (snapshot.status !== 'ready') return <p className="dst-error">{t('unavailable')}</p>

  return (
    <section className="dst-section">
      <header className="dst-hero">
        <div>
          <h2>{t('title')}</h2>
          <p className="dst-intro">{t('intro')}</p>
        </div>
        <span className={`dst-badge${form.enabled ? ' dst-badge--ok' : ''}`}>
          {form.enabled ? t('statusRunning') : t('statusNotRunning')}
        </span>
      </header>

      <ol className="dst-progress" aria-label={t('setupProgress')}>
        <li className={paired ? 'is-done' : 'is-current'}><span>1</span>{t('stepPair')}</li>
        <li className={permissionsReady ? 'is-done' : paired ? 'is-current' : ''}><span>2</span>{t('stepAuthorize')}</li>
        <li className={form.enabled ? 'is-done' : canLaunch ? 'is-current' : ''}><span>3</span>{t('stepLaunch')}</li>
      </ol>

      <div className="dst-card">
        <div className="dst-card-title"><span className="dst-step">1</span><div><h3>{t('pairTitle')}</h3><p className="dst-hint">{t('pairHint')}</p></div></div>
        <div className="dst-status-row">
          <span className={`dst-badge${paired ? ' dst-badge--ok' : ''}`}>
            {paired ? t('statusAppConfigured') : t('statusAppUnconfigured')}
          </span>
          {form.appId !== '' ? <code>{form.appId}</code> : null}
        </div>
        <div className="dst-inline-actions">
          <button className="dst-button" type="button" disabled={!snapshot.writable || setup.loading || setup.value?.status === 'waiting'} onClick={() => { void beginSetup('create') }}>
            {paired ? t('createAnotherApp') : t('createApp')}
          </button>
          {setup.value?.url !== undefined ? <a className="dst-button dst-button--secondary" href={setup.value.url} target="_blank" rel="noreferrer">{t('reopenSetup')}</a> : null}
          {setup.value?.status === 'waiting' ? <button className="dst-link-button" type="button" onClick={() => { void props.cancelSetup() }}>{t('cancel')}</button> : null}
        </div>
        {setup.value?.status === 'waiting' ? <p className="dst-callout">{t('waitingForLark')}</p> : null}
        {setup.value?.kind === 'create' && setup.value.status === 'completed' ? <p className="dst-success">{t('pairCompleted')}</p> : null}
        {setup.error !== undefined ? <p className="dst-error">{t('setupFailed')}: {setup.error}</p> : null}

        <details className="dst-details">
          <summary>{t('manualSetup')}</summary>
          <p className="dst-hint">{t('manualSetupHint')}</p>
          <div className="dst-row">
            <label htmlFor="dst-tenant">{t('tenant')}</label>
            <select id="dst-tenant" className="dst-select" value={form.tenant} disabled={!snapshot.writable} onChange={event => { patch({ tenant: event.target.value === 'lark' ? 'lark' : 'feishu' }) }}>
              <option value="feishu">{t('tenantFeishu')}</option>
              <option value="lark">{t('tenantLark')}</option>
            </select>
          </div>
          <div className="dst-row">
            <div className="dst-field"><label htmlFor="dst-app-id">{t('appId')}</label><span className="dst-hint">{t('appIdHint')}</span></div>
            <input id="dst-app-id" className="dst-input" value={form.appId} disabled={!snapshot.writable} autoComplete="off" onChange={event => { patch({ appId: event.target.value }) }} />
          </div>
          <div className="dst-row">
            <div className="dst-field"><label htmlFor="dst-app-secret">{t('appSecret')}</label><span className="dst-hint">{t('appSecretHint')}</span></div>
            <input id="dst-app-secret" className="dst-input" type="password" value={secret} disabled={!credential.writable} autoComplete="new-password" onChange={event => { setSecret(event.target.value); setDirty(true); setResult(undefined) }} />
          </div>
        </details>
      </div>

      <div className={`dst-card${paired ? '' : ' dst-card--muted'}`}>
        <div className="dst-card-title"><span className="dst-step">2</span><div><h3>{t('authorizeTitle')}</h3><p className="dst-hint">{t('authorizeHint')}</p></div></div>
        <p className="dst-callout">{t('permissionBundle')}</p>
        <div className="dst-permission-list">
          {PERMISSION_BUNDLE.map(item => {
            const granted = permissions.capabilities.includes(item.capability)
            return (
              <div key={item.capability}>
                <span className={`dst-check${granted ? ' is-done' : ''}`}>{granted ? '✓' : '!'}</span>
                <code>{item.codes}</code>
                <span>{t(item.label)}</span>
              </div>
            )
          })}
        </div>
        {permissions.status === 'missing' ? <p className="dst-callout dst-callout--warning">{t('permissionsMissing')}</p> : null}
        {permissions.status === 'unknown' ? <p className="dst-error">{t('permissionsUnknown')}{permissions.error === undefined ? '' : `: ${permissions.error}`}</p> : null}
        <div className="dst-inline-actions">
          <button className="dst-button" type="button" disabled={!paired || setup.loading || setup.value?.status === 'waiting'} onClick={() => { void beginSetup('authorize') }}>{permissionsReady ? t('reauthorize') : t('authorizeNow')}</button>
          <button className="dst-button dst-button--secondary" type="button" disabled={!paired || permissions.loading} onClick={() => { void props.refreshPermissions() }}>{permissions.loading ? t('checking') : t('checkAgain')}</button>
        </div>
        {setup.value?.kind === 'authorize' && setup.value.status === 'ready' ? <p className="dst-callout">{t('authorizationRefreshing')}</p> : null}
        {setup.value?.kind === 'authorize' && setup.value.status === 'completed' ? <p className="dst-success">{t('authorizationCompleted')}</p> : null}
      </div>

      <div className={`dst-card${permissionsReady ? '' : ' dst-card--muted'}`}>
        <div className="dst-card-title"><span className="dst-step">3</span><div><h3>{t('configureTitle')}</h3><p className="dst-hint">{t('configureHint')}</p></div></div>

        <fieldset className="dst-fieldset">
          <legend>{t('whereRuns')}</legend>
          <label className="dst-choice"><input type="radio" name="group-mode" checked={groupMode === 'all'} disabled={!snapshot.writable} onChange={() => { setGroupMode('all'); patch({ groupAllowlist: [] }) }} /><span><strong>{t('allGroups')}</strong><small>{t('allGroupsHint')}</small></span></label>
          <label className="dst-choice"><input type="radio" name="group-mode" checked={groupMode === 'specific'} disabled={!snapshot.writable} onChange={() => { setGroupMode('specific'); setDirty(true) }} /><span><strong>{t('specificGroups')}</strong><small>{t('specificGroupsHint')}</small></span></label>
          {groupMode === 'specific' ? <textarea className="dst-textarea" aria-label={t('groupAllowlist')} value={form.groupAllowlist.join('\n')} disabled={!snapshot.writable} placeholder="oc_…" onChange={event => { patch({ groupAllowlist: listOf(event.target.value) }) }} /> : null}
        </fieldset>

        <div className="dst-row"><label htmlFor="dst-dm-mode">{t('dmMode')}</label><select id="dst-dm-mode" className="dst-select" value={form.dmMode} disabled={!snapshot.writable} onChange={event => { const value = event.target.value; patch({ dmMode: value === 'allowlist' || value === 'disabled' ? value : 'open' }) }}><option value="open">{t('dmOpen')}</option><option value="allowlist">{t('dmAllowlist')}</option><option value="disabled">{t('dmDisabled')}</option></select></div>
        {form.dmMode === 'allowlist' ? <div className="dst-row"><div className="dst-field"><label htmlFor="dst-dm-list">{t('dmAllowlistLabel')}</label><span className="dst-hint">{t('dmAllowlistHint')}</span></div><textarea id="dst-dm-list" className="dst-textarea" value={form.dmAllowlist.join('\n')} disabled={!snapshot.writable} onChange={event => { patch({ dmAllowlist: listOf(event.target.value) }) }} /></div> : null}
        <label className="dst-toggle"><input type="checkbox" checked={form.requireMention} disabled={!snapshot.writable} onChange={event => { patch({ requireMention: event.target.checked }) }} /><span>{t('requireMention')}</span></label>

        <div className="dst-row">
          <div className="dst-field"><label htmlFor="dst-model">{t('modelSelection')}</label><span className="dst-hint">{t('modelSelectionHint')}</span></div>
          <select id="dst-model" className="dst-select" value={currentRoute} disabled={!snapshot.writable || models.loading} onChange={event => { if (event.target.value === '') patch({ provider: '', model: '' }); else { const [provider, model] = JSON.parse(event.target.value) as [string, string]; patch({ provider, model }) } }}>
            <option value="">{t('modelDefault')}</option>
            {!currentListed ? <option value={currentRoute}>{form.provider} / {form.model} ({t('modelCurrentCustom')})</option> : null}
            {modelGroups.map(([name, options]) => <optgroup label={name} key={name}>{options.map(option => <option value={routeValue(option.provider, option.model)} key={`${option.provider}/${option.model}`}>{option.modelName}</option>)}</optgroup>)}
          </select>
        </div>
        {models.error !== undefined ? <details className="dst-details"><summary>{t('manualModel')}</summary><p className="dst-hint">{t('manualModelHint')}</p><div className="dst-row"><input className="dst-input" aria-label={t('provider')} value={form.provider} disabled={!snapshot.writable} onChange={event => { patch({ provider: event.target.value }) }} /><input className="dst-input" aria-label={t('model')} value={form.model} disabled={!snapshot.writable} onChange={event => { patch({ model: event.target.value }) }} /></div></details> : null}

        <div className="dst-row"><div className="dst-field"><span>{t('cwd')}</span><span className="dst-hint">{form.cwd === '' ? t('cwdDefault') : form.cwd}</span></div><div className="dst-inline-actions"><button className="dst-button dst-button--secondary" type="button" disabled={!snapshot.writable} onClick={() => { void chooseDirectory() }}>{t('chooseFolder')}</button>{form.cwd !== '' ? <button className="dst-link-button" type="button" disabled={!snapshot.writable} onClick={() => { patch({ cwd: '' }) }}>{t('useDefault')}</button> : null}</div></div>
        {directoryError ? <p className="dst-error">{t('directoryFailed')}</p> : null}

        <details className="dst-details"><summary>{t('advancedMemory')}</summary><p className="dst-hint">{t('memoryHint')}</p><div className="dst-row"><div className="dst-field"><label htmlFor="dst-workspace-memory-groups">{t('workspaceMemoryGroups')}</label><span className="dst-hint">{t('workspaceMemoryGroupsHint')}</span></div><textarea id="dst-workspace-memory-groups" className="dst-textarea" value={form.workspaceMemoryGroups.join('\n')} disabled={!snapshot.writable} onChange={event => { patch({ workspaceMemoryGroups: listOf(event.target.value) }) }} /></div></details>

        <div className="dst-launch">
          <label className="dst-toggle"><input type="checkbox" checked={form.enabled} disabled={!snapshot.writable || (!form.enabled && !canLaunch)} onChange={event => { patch({ enabled: event.target.checked }) }} /><span><strong>{t('enabled')}</strong><small>{canLaunch || form.enabled ? t('enabledHint') : t('launchBlocked')}</small></span></label>
        </div>
      </div>

      {validation === 'appId' ? <p className="dst-error">{t('invalidAppId')}</p> : null}
      {validation === 'dmAllowlist' ? <p className="dst-error">{t('invalidAllowlist')}</p> : null}
      {validation === 'modelRoute' ? <p className="dst-error">{t('invalidModelRoute')}</p> : null}
      {invalidGroupScope ? <p className="dst-error">{t('invalidGroupScope')}</p> : null}
      {result === 'credential' ? <p className="dst-error">{t('credentialFailed')}</p> : null}
      {result === 'settings' && validation === undefined ? <p className="dst-error">{t('settingsFailed')}</p> : null}
      {result === 'saved' ? <p className="dst-success">{t('saved')}</p> : null}
      <div className="dst-actions"><button className="dst-button" type="button" disabled={!snapshot.writable || !dirty || saving || validation !== undefined || invalidGroupScope} onClick={() => { void save() }}>{saving ? t('saving') : t('save')}</button></div>
    </section>
  )
}
