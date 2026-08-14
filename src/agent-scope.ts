/** Deterministic Claude Tag-style Agent configuration resolution for Lark places. */

import type { ResolvedConfig } from './config.js'
import type { AgentProfileSettings, LarkGroupScopeSettings } from './contract.js'

export interface AgentScopeTarget {
  chatType: 'p2p' | 'group'
  chatId: string
}

/** Behavior frozen when a thread starts; credential authorization is resolved separately per operation. */
export interface ResolvedAgentBehavior {
  enabled: boolean
  kind: 'direct-message' | 'group'
  profileId: string
  profileName: string
  instructions: string
  provider: string
  model: string
  cwd: string
  requireMention: boolean
  /** References only; bundles and credentials are resolved live at the operation boundary. */
  accessBundleIds: string[]
  /** Exact group scope that contributed the narrowest behavior, when one exists. */
  groupScope?: LarkGroupScopeSettings
}

function orderedUnion(...lists: ReadonlyArray<readonly string[]>): string[] {
  return [...new Set(lists.flatMap(list => list.map(value => value.trim()).filter(Boolean)))]
}

function instructionsOf(...layers: Array<string | undefined>): string {
  return layers.map(value => value?.trim() ?? '').filter(Boolean).join('\n\n')
}

function profileOf(config: ResolvedConfig, id: string): AgentProfileSettings | undefined {
  return id === '' ? undefined : config.agentProfiles.find(profile => profile.id === id)
}

function inheritedRoute(
  config: ResolvedConfig,
  profile: AgentProfileSettings | undefined,
  scope: LarkGroupScopeSettings | undefined,
): { provider: string; model: string } {
  if ((scope?.provider ?? '') !== '') return { provider: scope?.provider ?? '', model: scope?.model ?? '' }
  if ((profile?.provider ?? '') !== '') return { provider: profile?.provider ?? '', model: profile?.model ?? '' }
  return { provider: config.provider, model: config.model }
}

/**
 * Resolve one place without consulting mutable runtime state. DMs deliberately
 * retain the legacy Harness route/workdir but never inherit organization Agent
 * profiles, instructions, or access bundles.
 */
export function resolveAgentBehavior(config: ResolvedConfig, target: AgentScopeTarget): ResolvedAgentBehavior {
  if (target.chatType === 'p2p') {
    return {
      enabled: config.dmMode !== 'disabled',
      kind: 'direct-message',
      profileId: 'direct-message',
      profileName: 'Direct message',
      instructions: '',
      provider: config.provider,
      model: config.model,
      cwd: config.cwd,
      requireMention: false,
      accessBundleIds: [],
    }
  }

  const groupScope = config.groupScopes.find(scope => scope.chatId === target.chatId)
  const selectedProfileId = groupScope?.agentProfileId || config.defaultAgentProfileId
  const profile = profileOf(config, selectedProfileId)
  const route = inheritedRoute(config, profile, groupScope)
  const responseMode = groupScope?.responseMode ?? 'inherit'
  return {
    enabled: groupScope?.enabled ?? true,
    kind: 'group',
    profileId: profile?.id ?? 'default',
    profileName: profile?.name ?? 'Default Agent',
    instructions: instructionsOf(config.defaultInstructions, profile?.instructions, groupScope?.instructions),
    provider: route.provider,
    model: route.model,
    cwd: groupScope?.cwd || profile?.cwd || config.cwd,
    requireMention: responseMode === 'inherit' ? config.requireMention : responseMode === 'mention',
    accessBundleIds: orderedUnion(
      config.defaultAccessBundleIds,
      profile?.accessBundleIds ?? [],
      groupScope?.accessBundleIds ?? [],
    ),
    ...(groupScope === undefined ? {} : { groupScope }),
  }
}
