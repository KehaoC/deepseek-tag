import { describe, expect, it } from 'vitest'
import { resolveAgentBehavior } from '../src/agent-scope.js'
import { resolveConfig } from '../src/config.js'

describe('Agent scope resolution', () => {
  const config = resolveConfig({
    provider: 'legacy-provider',
    model: 'legacy-model',
    cwd: '/legacy',
    requireMention: true,
    defaultInstructions: 'Organization guidance.',
    defaultAccessBundleIds: ['baseline'],
    defaultAgentProfileId: 'engineer',
    agentProfiles: [{
      id: 'engineer',
      name: 'Engineer',
      instructions: 'Engineering guidance.',
      provider: 'profile-provider',
      model: 'profile-model',
      cwd: '/profile',
      accessBundleIds: ['github-read'],
    }],
    groupScopes: [{
      chatId: 'oc_write',
      name: 'Write channel',
      instructions: 'Open draft pull requests.',
      provider: 'scope-provider',
      model: 'scope-model',
      cwd: '/scope',
      accessBundleIds: ['github-write', 'baseline'],
      responseMode: 'automatic',
    }],
  })

  it('concatenates instructions and unions grants from broad to narrow scope', () => {
    expect(resolveAgentBehavior(config, { chatType: 'group', chatId: 'oc_write' })).toMatchObject({
      enabled: true,
      profileId: 'engineer',
      instructions: 'Organization guidance.\n\nEngineering guidance.\n\nOpen draft pull requests.',
      provider: 'scope-provider',
      model: 'scope-model',
      cwd: '/scope',
      requireMention: false,
      accessBundleIds: ['baseline', 'github-read', 'github-write'],
    })
  })

  it('uses the default profile for a group without an exact binding', () => {
    expect(resolveAgentBehavior(config, { chatType: 'group', chatId: 'oc_other' })).toMatchObject({
      profileId: 'engineer',
      instructions: 'Organization guidance.\n\nEngineering guidance.',
      provider: 'profile-provider',
      model: 'profile-model',
      cwd: '/profile',
      requireMention: true,
      accessBundleIds: ['baseline', 'github-read'],
    })
  })

  it('keeps direct messages outside organization profiles and bundles', () => {
    expect(resolveAgentBehavior(config, { chatType: 'p2p', chatId: 'oc_dm' })).toEqual({
      enabled: true,
      kind: 'direct-message',
      profileId: 'direct-message',
      profileName: 'Direct message',
      instructions: '',
      provider: 'legacy-provider',
      model: 'legacy-model',
      cwd: '/legacy',
      requireMention: false,
      accessBundleIds: [],
    })
  })
})
