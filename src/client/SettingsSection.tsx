/** Guided Deepseek Tag setup and ongoing configuration page. */

import { useEffect, useMemo, useState } from 'react'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DeepseekTagSettings, LarkSetupView } from '../contract.js'
import { resolveChannelBehavior } from '../channel-scope.js'
import {
  formOf,
  validateForm,
  type ChatDirectoryState,
  type CredentialState,
  type ModelCatalogState,
  type PermissionState,
  type SaveResult,
  type SetupState,
  type TagForm,
} from './controller.js'
import type { LOCALE_NAMESPACE } from './locales.js'

export interface TagSettingsInjected {
  hooks: {
    tagSettings: SettingsScope<DeepseekTagSettings>
    credential: SnapshotStore<CredentialState>
    setup: SnapshotStore<SetupState>
    permissions: SnapshotStore<PermissionState>
    chats: SnapshotStore<ChatDirectoryState>
    models: SnapshotStore<ModelCatalogState>
  }
  save(form: TagForm, appSecret: string): Promise<SaveResult>
  createApp(): Promise<LarkSetupView | undefined>
  authorizeApp(): Promise<LarkSetupView | undefined>
  pollSetup(): Promise<LarkSetupView | undefined>
  cancelSetup(): Promise<void>
  refreshPermissions(): Promise<void>
  refreshChats(): Promise<void>
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
  const chats = props.useChats(value => value)
  const models = props.useModels(value => value)
  const [form, setForm] = useState<TagForm>(() => formOf(snapshot.value))
  const [secret, setSecret] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<'saved' | 'credential' | 'settings'>()
  const [directoryError, setDirectoryError] = useState(false)
  const [selectedScopeIndex, setSelectedScopeIndex] = useState<number | null>(null)
  const { t } = props

  useEffect(() => {
    const next = formOf(snapshot.value)
    setForm(next)
    setDirty(false)
  }, [snapshot.revision, snapshot.value])

  useEffect(() => {
    if (credential.configured && (snapshot.value?.appId ?? '') !== '') {
      void props.refreshPermissions()
      void props.refreshChats()
    }
  }, [credential.configured, snapshot.revision])

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

  const chooseDirectory = async (applyPath: (path: string) => void = path => { patch({ cwd: path }) }): Promise<void> => {
    setDirectoryError(false)
    try {
      const path = await props.pickDirectory()
      if (path !== null) applyPath(path)
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
  const configuredChatIds = new Set(form.groupScopes.map(scope => scope.chatId.trim()).filter(Boolean))

  const patchGroupScope = (index: number, value: Partial<TagForm['groupScopes'][number]>): void => {
    patch({
      groupScopes: form.groupScopes.map((group, offset) => (
        offset === index ? { ...group, ...value } : group
      )),
    })
  }

  const addGroupScope = (chatId: string, name: string): void => {
    const existingIndex = form.groupScopes.findIndex(scope => scope.chatId === chatId)
    if (existingIndex >= 0) {
      setSelectedScopeIndex(existingIndex)
      return
    }
    patch({ groupScopes: [...form.groupScopes, { chatId, name, enabled: true, instructions: '', provider: '', model: '', cwd: '', responseMode: 'inherit' }] })
    setSelectedScopeIndex(form.groupScopes.length)
  }

  const removeGroupScope = (index: number): void => {
    patch({ groupScopes: form.groupScopes.filter((_, offset) => offset !== index) })
    setSelectedScopeIndex(null)
  }

  const routeSelect = (
    provider: string,
    model: string,
    inheritedLabel: string,
    onChange: (provider: string, model: string) => void,
  ) => {
    const value = routeValue(provider, model)
    const listed = value === '' || models.options.some(option => (
      option.provider === provider && option.model === model
    ))
    return (
      <select className="dst-select" value={value} disabled={!snapshot.writable || models.loading} onChange={event => {
        if (event.target.value === '') onChange('', '')
        else {
          const [nextProvider, nextModel] = JSON.parse(event.target.value) as [string, string]
          onChange(nextProvider, nextModel)
        }
      }}>
        <option value="">{inheritedLabel}</option>
        {!listed ? <option value={value}>{provider} / {model} ({t('modelCurrentCustom')})</option> : null}
        {modelGroups.map(([name, options]) => <optgroup label={name} key={name}>{options.map(option => <option value={routeValue(option.provider, option.model)} key={`${option.provider}/${option.model}`}>{option.modelName}</option>)}</optgroup>)}
      </select>
    )
  }

  if (snapshot.status === 'loading') return <p className="dst-hint">{t('statusLoading')}</p>
  if (snapshot.status !== 'ready') return <p className="dst-error">{t('unavailable')}</p>

  return (
    <section className="dst-section">
      <header className="dst-hero">
        <div>
          <h2>{t('title')}</h2>
        </div>
        <span className={`dst-badge${form.enabled ? ' dst-badge--ok' : ''}`}>
          {form.enabled ? t('statusRunning') : t('statusNotRunning')}
        </span>
      </header>

      <details className="dst-onboarding" open={canLaunch ? undefined : true}>
        <summary><span><strong>{t('onboardingTitle')}</strong></span><span className={`dst-mini-status${paired && permissionsReady ? '' : ' is-off'}`}>{paired && permissionsReady ? '✓' : '!'}</span></summary>
        <div className="dst-onboarding-body">
      <ol className="dst-progress" aria-label={t('setupProgress')}>
        <li className={paired ? 'is-done' : 'is-current'}><span>1</span>{t('stepPair')}</li>
        <li className={permissionsReady ? 'is-done' : paired ? 'is-current' : ''}><span>2</span>{t('stepAuthorize')}</li>
        <li className={form.enabled ? 'is-done' : canLaunch ? 'is-current' : ''}><span>3</span>{t('stepLaunch')}</li>
      </ol>

      <div className="dst-card">
        <div className="dst-card-title"><span className="dst-step">1</span><div><h3>{t('pairTitle')}</h3></div></div>
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
          <div className="dst-row">
            <label htmlFor="dst-tenant">{t('tenant')}</label>
            <select id="dst-tenant" className="dst-select" value={form.tenant} disabled={!snapshot.writable} onChange={event => { patch({ tenant: event.target.value === 'lark' ? 'lark' : 'feishu' }) }}>
              <option value="feishu">{t('tenantFeishu')}</option>
              <option value="lark">{t('tenantLark')}</option>
            </select>
          </div>
          <div className="dst-row">
            <label htmlFor="dst-app-id">{t('appId')}</label>
            <input id="dst-app-id" className="dst-input" value={form.appId} disabled={!snapshot.writable} autoComplete="off" onChange={event => { patch({ appId: event.target.value }) }} />
          </div>
          <div className="dst-row">
            <div className="dst-field"><label htmlFor="dst-app-secret">{t('appSecret')}</label><span className="dst-hint">{t('appSecretHint')}</span></div>
            <input id="dst-app-secret" className="dst-input" type="password" value={secret} disabled={!credential.writable} autoComplete="new-password" onChange={event => { setSecret(event.target.value); setDirty(true); setResult(undefined) }} />
          </div>
        </details>
      </div>

      <div className={`dst-card${paired ? '' : ' dst-card--muted'}`}>
        <div className="dst-card-title"><span className="dst-step">2</span><div><h3>{t('authorizeTitle')}</h3></div></div>
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
        <div className="dst-card-title"><span className="dst-step">3</span><div><h3>{t('configureTitle')}</h3></div></div>

        <div className="dst-row"><label htmlFor="dst-dm-mode">{t('dmMode')}</label><select id="dst-dm-mode" className="dst-select" value={form.dmMode} disabled={!snapshot.writable} onChange={event => { const value = event.target.value; patch({ dmMode: value === 'allowlist' || value === 'disabled' ? value : 'open' }) }}><option value="open">{t('dmOpen')}</option><option value="allowlist">{t('dmAllowlist')}</option><option value="disabled">{t('dmDisabled')}</option></select></div>
        {form.dmMode === 'allowlist' ? <div className="dst-row"><div className="dst-field"><label htmlFor="dst-dm-list">{t('dmAllowlistLabel')}</label><span className="dst-hint">{t('dmAllowlistHint')}</span></div><textarea id="dst-dm-list" className="dst-textarea" value={form.dmAllowlist.join('\n')} disabled={!snapshot.writable} onChange={event => { patch({ dmAllowlist: listOf(event.target.value) }) }} /></div> : null}
        <label className="dst-toggle"><input type="checkbox" checked={form.requireMention} disabled={!snapshot.writable} onChange={event => { patch({ requireMention: event.target.checked }) }} /><span>{t('requireMention')}</span></label>

        <div className="dst-field"><label htmlFor="dst-default-instructions">{t('defaultInstructions')}</label><textarea id="dst-default-instructions" className="dst-textarea" value={form.defaultInstructions} disabled={!snapshot.writable} onChange={event => { patch({ defaultInstructions: event.target.value }) }} /></div>

        <div className="dst-row">
          <label htmlFor="dst-model">{t('modelSelection')}</label>
          <select id="dst-model" className="dst-select" value={currentRoute} disabled={!snapshot.writable || models.loading} onChange={event => { if (event.target.value === '') patch({ provider: '', model: '' }); else { const [provider, model] = JSON.parse(event.target.value) as [string, string]; patch({ provider, model }) } }}>
            <option value="">{t('modelDefault')}</option>
            {!currentListed ? <option value={currentRoute}>{form.provider} / {form.model} ({t('modelCurrentCustom')})</option> : null}
            {modelGroups.map(([name, options]) => <optgroup label={name} key={name}>{options.map(option => <option value={routeValue(option.provider, option.model)} key={`${option.provider}/${option.model}`}>{option.modelName}</option>)}</optgroup>)}
          </select>
        </div>
        {models.error !== undefined ? <details className="dst-details"><summary>{t('manualModel')}</summary><p className="dst-hint">{t('manualModelHint')}</p><div className="dst-row"><input className="dst-input" aria-label={t('provider')} value={form.provider} disabled={!snapshot.writable} onChange={event => { patch({ provider: event.target.value }) }} /><input className="dst-input" aria-label={t('model')} value={form.model} disabled={!snapshot.writable} onChange={event => { patch({ model: event.target.value }) }} /></div></details> : null}

        <div className="dst-row"><div className="dst-field"><span>{t('cwd')}</span><span className="dst-hint">{form.cwd === '' ? t('cwdDefault') : form.cwd}</span></div><div className="dst-inline-actions"><button className="dst-button dst-button--secondary" type="button" disabled={!snapshot.writable} onClick={() => { void chooseDirectory() }}>{t('chooseFolder')}</button>{form.cwd !== '' ? <button className="dst-link-button" type="button" disabled={!snapshot.writable} onClick={() => { patch({ cwd: '' }) }}>{t('useDefault')}</button> : null}</div></div>
        {directoryError ? <p className="dst-error">{t('directoryFailed')}</p> : null}

        <div className="dst-launch">
          <label className="dst-toggle"><input type="checkbox" checked={form.enabled} disabled={!snapshot.writable || (!form.enabled && !canLaunch)} onChange={event => { patch({ enabled: event.target.checked }) }} /><span><strong>{t('enabled')}</strong>{!canLaunch && !form.enabled ? <small>{t('launchBlocked')}</small> : null}</span></label>
        </div>
      </div>

        </div>
      </details>

      <div className="dst-card dst-manager-card">
        <div className="dst-card-heading">
          <div className="dst-manager-heading"><div><h3>{t('scopesTitle')}</h3></div></div>
          <button className="dst-button dst-button--secondary" type="button" disabled={!paired || chats.loading} onClick={() => { void props.refreshChats() }}>{chats.loading ? t('refreshingGroups') : t('refreshGroups')}</button>
        </div>
        <div className="dst-manager-stack">
          <div className="dst-manager-list">
            <div className="dst-directory-heading"><span><strong>{t('availableGroups')}</strong></span><span>{String(chats.chats.length)}</span></div>
            {chats.status === 'unconfigured' ? <p className="dst-empty">{t('groupsNeedApp')}</p> : null}
            {chats.status === 'unavailable' ? <p className="dst-error">{t('groupsUnavailable')}{chats.error ? `: ${chats.error}` : ''}</p> : null}
            {chats.status === 'ready' && chats.chats.length === 0 ? <p className="dst-empty">{t('groupsEmpty')}</p> : null}
            {chats.status === 'ready' && chats.chats.length > 0 ? <div className="dst-directory-items">{chats.chats.map(chat => {
              const configured = configuredChatIds.has(chat.chatId)
              return <div key={chat.chatId}><span><strong>{chat.name || t('unnamedGroup')}</strong></span><button className={configured ? 'dst-link-button' : 'dst-button dst-button--secondary'} type="button" disabled={!snapshot.writable || configured} onClick={() => { addGroupScope(chat.chatId, chat.name) }}>{configured ? t('groupConfigured') : t('configureGroup')}</button></div>
            })}</div> : null}
            <div className="dst-directory-heading"><span><strong>{t('configuredScopes')}</strong></span><span>{String(form.groupScopes.length)}</span></div>
            <div className="dst-manager-items">{form.groupScopes.map((scope, index) => <button className={selectedScopeIndex === index ? 'is-selected' : ''} type="button" key={`${scope.chatId}-${String(index)}`} aria-expanded={selectedScopeIndex === index} onClick={() => { setSelectedScopeIndex(selectedScopeIndex === index ? null : index) }}><span><strong>{scope.name || t('unnamedGroup')}</strong></span><span className="dst-manager-item-tail"><span className={`dst-mini-status${scope.enabled === false ? ' is-off' : ''}`}>{scope.enabled === false ? t('scopeDisabled') : t('scopeEnabled')}</span><span>{selectedScopeIndex === index ? '⌃' : '⌄'}</span></span></button>)}</div>
            {form.groupScopes.length === 0 ? <p className="dst-empty">{t('scopesEmpty')}</p> : null}
          </div>
          <div className="dst-manager-detail">
        <div className="dst-editor-list">
          {form.groupScopes.map((group, index) => {
            if (index !== selectedScopeIndex) return null
            const effective = resolveChannelBehavior(form, { chatType: 'group', chatId: group.chatId })
            return (
              <div className="dst-detail-editor" key={`${group.chatId}-${String(index)}`}>
                <div className="dst-detail-title"><span>{group.name || t('unnamedGroup')}</span></div>
                <div className="dst-editor-body">
                  <label className="dst-toggle"><input type="checkbox" checked={group.enabled ?? true} disabled={!snapshot.writable} onChange={event => { patchGroupScope(index, { enabled: event.target.checked }) }} /><span>{t('scopeRuns')}</span></label>
                  <div className="dst-row"><span>{t('scopeResponse')}</span><select className="dst-select" value={group.responseMode ?? 'inherit'} disabled={!snapshot.writable} onChange={event => { const value = event.target.value; patchGroupScope(index, { responseMode: value === 'mention' || value === 'automatic' ? value : 'inherit' }) }}><option value="inherit">{t('scopeResponseInherit')}</option><option value="mention">{t('scopeResponseMention')}</option><option value="automatic">{t('scopeResponseAutomatic')}</option></select></div>
                  <div className="dst-field"><label>{t('scopeInstructions')}</label><textarea className="dst-textarea" value={group.instructions ?? ''} disabled={!snapshot.writable} onChange={event => { patchGroupScope(index, { instructions: event.target.value }) }} /></div>
                  <div className="dst-row"><span>{t('scopeModel')}</span>{routeSelect(group.provider ?? '', group.model ?? '', t('inheritWorkspace'), (provider, model) => { patchGroupScope(index, { provider, model }) })}</div>
                  <div className="dst-row"><div className="dst-field"><span>{t('scopeWorkspace')}</span><span className="dst-hint dst-path">{group.cwd || t('inheritWorkspace')}</span></div><div className="dst-inline-actions"><button className="dst-button dst-button--secondary" type="button" disabled={!snapshot.writable} onClick={() => { void chooseDirectory(path => { patchGroupScope(index, { cwd: path }) }) }}>{t('chooseFolder')}</button>{group.cwd ? <button className="dst-link-button" type="button" onClick={() => { patchGroupScope(index, { cwd: '' }) }}>{t('useDefault')}</button> : null}</div></div>
                  <div className="dst-effective"><strong>{t('effectiveTitle')}</strong><dl><div><dt>{t('effectiveModel')}</dt><dd>{effective.provider && effective.model ? `${effective.provider} / ${effective.model}` : t('modelDefault')}</dd></div><div><dt>{t('effectiveWorkspace')}</dt><dd>{effective.cwd || t('cwdDefault')}</dd></div><div><dt>{t('effectiveResponse')}</dt><dd>{effective.requireMention ? t('scopeResponseMention') : t('scopeResponseAutomatic')}</dd></div></dl></div>
                  <div className="dst-editor-actions"><button className="dst-link-button dst-link-button--danger" type="button" disabled={!snapshot.writable} onClick={() => { removeGroupScope(index) }}>{t('removeScope')}</button></div>
                </div>
              </div>
            )
          })}
        </div>
          </div>
        </div>
      </div>

      {validation === 'appId' ? <p className="dst-error">{t('invalidAppId')}</p> : null}
      {validation === 'dmAllowlist' ? <p className="dst-error">{t('invalidAllowlist')}</p> : null}
      {validation === 'modelRoute' ? <p className="dst-error">{t('invalidModelRoute')}</p> : null}
      {validation === 'channelScopes' ? <p className="dst-error">{t('invalidChannelScopes')}</p> : null}
      {result === 'credential' ? <p className="dst-error">{t('credentialFailed')}</p> : null}
      {result === 'settings' && validation === undefined ? <p className="dst-error">{t('settingsFailed')}</p> : null}
      {result === 'saved' ? <p className="dst-success">{t('saved')}</p> : null}
      <div className="dst-actions"><button className="dst-button" type="button" disabled={!snapshot.writable || !dirty || saving || validation !== undefined} onClick={() => { void save() }}>{saving ? t('saving') : t('save')}</button></div>
    </section>
  )
}
