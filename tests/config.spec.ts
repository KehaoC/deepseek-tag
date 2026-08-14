import { describe, expect, it } from 'vitest'
import { resolveConfig, type ResolvedConfig } from '../src/config.js'

describe('Deepseek Tag config', () => {
  it('installs inert with safe defaults', () => {
    expect(resolveConfig()).toMatchObject({
      enabled: false,
      appSecretEnv: 'DEEPSEEK_TAG_LARK_APP_SECRET',
      tenant: 'feishu',
      dmMode: 'open',
      requireMention: true,
      sandboxMode: 'workspace-write',
    })
  })

  it('rejects enabled configurations that cannot admit a valid connection', () => {
    expect(() => resolveConfig({ enabled: true })).toThrow(/appId/)
    expect(() => resolveConfig({
      enabled: true,
      appId: 'cli_test',
      dmMode: 'allowlist',
    })).toThrow(/dmAllowlist/)
    expect(() => resolveConfig({
      enabled: true,
      appId: 'cli_test',
      provider: 'deepseek-official',
    })).toThrow(/provider and model/)
  })

  it('rejects ambiguous channel-scope configuration while disabled', () => {
    expect(() => resolveConfig({
      groupScopes: [{ chatId: 'oc_one' }, { chatId: 'oc_one' }],
    })).toThrow(/duplicate group scope/)
    expect(() => resolveConfig({
      groupScopes: [{ chatId: 'oc_one', provider: 'provider-only' }],
    })).toThrow(/provider and model/)
  })

  it('strips the removed Agent-profile and placeholder Access settings', () => {
    const resolved = resolveConfig({
      agentProfiles: [{ id: 'legacy', name: 'Legacy' }],
      defaultAgentProfileId: 'legacy',
      defaultAccessBundleIds: ['placeholder'],
      groupScopes: [{ chatId: 'oc_one', agentProfileId: 'legacy', accessBundleIds: ['placeholder'] }],
    } as never) as ResolvedConfig & Record<string, unknown>
    expect(resolved.agentProfiles).toBeUndefined()
    expect(resolved.defaultAgentProfileId).toBeUndefined()
    expect(resolved.defaultAccessBundleIds).toBeUndefined()
    expect(resolved.groupScopes[0]).not.toHaveProperty('agentProfileId')
    expect(resolved.groupScopes[0]).not.toHaveProperty('accessBundleIds')
  })
})
