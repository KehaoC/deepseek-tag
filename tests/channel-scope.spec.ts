import { describe, expect, it } from 'vitest'
import { resolveChannelBehavior } from '../src/channel-scope.js'
import { resolveConfig } from '../src/config.js'

describe('channel scope resolution', () => {
  const config = resolveConfig({
    provider: 'workspace-provider',
    model: 'workspace-model',
    cwd: '/workspace',
    sandboxMode: 'workspace-write',
    requireMention: true,
    defaultInstructions: 'Workspace guidance.',
    groupScopes: [{
      chatId: 'oc_write',
      name: 'Write channel',
      instructions: 'Open draft pull requests.',
      provider: 'scope-provider',
      model: 'scope-model',
      cwd: '/scope',
      sandboxMode: 'read-only',
      responseMode: 'automatic',
    }],
  })

  it('concatenates instructions and resolves overrides from workspace to channel', () => {
    expect(resolveChannelBehavior(config, { chatType: 'group', chatId: 'oc_write' })).toMatchObject({
      enabled: true,
      scopeName: 'Write channel',
      instructions: 'Workspace guidance.\n\nOpen draft pull requests.',
      provider: 'scope-provider',
      model: 'scope-model',
      cwd: '/scope',
      sandboxMode: 'read-only',
      requireMention: false,
    })
  })

  it('uses workspace defaults for a group without an exact override', () => {
    expect(resolveChannelBehavior(config, { chatType: 'group', chatId: 'oc_other' })).toMatchObject({
      scopeName: 'Workspace default',
      instructions: 'Workspace guidance.',
      provider: 'workspace-provider',
      model: 'workspace-model',
      cwd: '/workspace',
      sandboxMode: 'workspace-write',
      requireMention: true,
    })
  })

  it('keeps direct messages outside organization channel scopes and bundles', () => {
    expect(resolveChannelBehavior(config, { chatType: 'p2p', chatId: 'oc_dm' })).toEqual({
      enabled: true,
      kind: 'direct-message',
      scopeName: 'Direct message',
      instructions: '',
      provider: 'workspace-provider',
      model: 'workspace-model',
      cwd: '/workspace',
      sandboxMode: 'workspace-write',
      requireMention: false,
    })
  })
})
