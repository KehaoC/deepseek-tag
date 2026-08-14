/** Deterministic Claude Tag-style behavior resolution for Lark places. */

import type { ResolvedConfig } from './config.js'
import type { LarkGroupScopeSettings } from './contract.js'

export interface ChannelScopeTarget {
  chatType: 'p2p' | 'group'
  chatId: string
}

/** Behavior frozen when a thread starts; connection authorization stays live. */
export interface ResolvedChannelBehavior {
  enabled: boolean
  kind: 'direct-message' | 'group'
  scopeName: string
  instructions: string
  provider: string
  model: string
    cwd: string
    sandboxMode: 'read-only' | 'workspace-write'
    requireMention: boolean
  /** Exact channel scope that contributed the narrowest behavior, when present. */
  groupScope?: LarkGroupScopeSettings
}

function instructionsOf(...layers: Array<string | undefined>): string {
  return layers.map(value => value?.trim() ?? '').filter(Boolean).join('\n\n')
}

/** Resolve workspace defaults plus one exact channel override. */
export function resolveChannelBehavior(config: ResolvedConfig, target: ChannelScopeTarget): ResolvedChannelBehavior {
  if (target.chatType === 'p2p') {
    return {
      enabled: config.dmMode !== 'disabled',
      kind: 'direct-message',
      scopeName: 'Direct message',
      instructions: '',
      provider: config.provider,
      model: config.model,
      cwd: config.cwd,
      sandboxMode: config.sandboxMode,
      requireMention: false,
    }
  }

  const groupScope = config.groupScopes.find(scope => scope.chatId === target.chatId)
  const responseMode = groupScope?.responseMode ?? 'inherit'
  const sandboxMode = groupScope?.sandboxMode ?? 'inherit'
  return {
    enabled: groupScope?.enabled ?? true,
    kind: 'group',
    scopeName: groupScope?.name?.trim() || groupScope?.chatId || 'Workspace default',
    instructions: instructionsOf(config.defaultInstructions, groupScope?.instructions),
    provider: groupScope?.provider || config.provider,
    model: groupScope?.model || config.model,
    cwd: groupScope?.cwd || config.cwd,
    sandboxMode: sandboxMode === 'inherit' ? config.sandboxMode : sandboxMode,
    requireMention: responseMode === 'inherit' ? config.requireMention : responseMode === 'mention',
    ...(groupScope === undefined ? {} : { groupScope }),
  }
}
