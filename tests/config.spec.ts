import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'

describe('Deepseek Tag config', () => {
  it('installs inert with safe defaults', () => {
    expect(resolveConfig()).toMatchObject({
      enabled: false,
      appSecretEnv: 'DEEPSEEK_TAG_LARK_APP_SECRET',
      tenant: 'feishu',
      dmMode: 'open',
      requireMention: true,
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

  it('rejects ambiguous or dangling scoped Agent configuration while disabled', () => {
    expect(() => resolveConfig({
      agentProfiles: [{ id: 'engineer', name: 'One' }, { id: 'engineer', name: 'Two' }],
    })).toThrow(/duplicate Agent profile/)
    expect(() => resolveConfig({ defaultAgentProfileId: 'missing' })).toThrow(/does not exist/)
    expect(() => resolveConfig({
      groupScopes: [{ chatId: 'oc_one', agentProfileId: 'missing' }],
    })).toThrow(/unknown Agent profile/)
    expect(() => resolveConfig({
      groupScopes: [{ chatId: 'oc_one' }, { chatId: 'oc_one' }],
    })).toThrow(/duplicate group scope/)
  })
})
