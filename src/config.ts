/** Deepseek Tag deployment configuration and loader-visible schema. */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_APP_SECRET_REF,
  type DeepseekTagSettings,
  type DirectMessageMode,
  type AgentProfileSettings,
  type LarkGroupScopeSettings,
  type LarkTenant,
} from './contract.js'

/** Loader-facing name for the shared settings contract. */
export type Config = DeepseekTagSettings

/** Configuration after schema defaults have been applied. */
export interface ResolvedConfig {
  enabled: boolean
  appId: string
  appSecretEnv: string
  tenant: LarkTenant
  dmMode: DirectMessageMode
  dmAllowlist: string[]
  groupAllowlist: string[]
  workspaceMemoryGroups: string[]
  requireMention: boolean
  cwd: string
  provider: string
  model: string
  agentProfiles: AgentProfileSettings[]
  defaultAgentProfileId: string
  defaultInstructions: string
  defaultAccessBundleIds: string[]
  groupScopes: LarkGroupScopeSettings[]
}

const agentProfileSchema = z.object({
  id: z.string().required(),
  name: z.string().required(),
  instructions: z.string().default(''),
  provider: z.string().default(''),
  model: z.string().default(''),
  cwd: z.string().default(''),
  accessBundleIds: z.array(z.string()).default([]),
})

const groupScopeSchema = z.object({
  chatId: z.string().required(),
  name: z.string().default(''),
  enabled: z.boolean().default(true),
  agentProfileId: z.string().default(''),
  instructions: z.string().default(''),
  provider: z.string().default(''),
  model: z.string().default(''),
  cwd: z.string().default(''),
  accessBundleIds: z.array(z.string()).default([]),
  responseMode: z.union(['inherit', 'mention', 'automatic']).default('inherit'),
})

/** Loader-visible schema. Secrets remain in the credential provider, not this section. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  appId: z.string().default(''),
  appSecretEnv: z.string().role('credential-ref').default(DEFAULT_APP_SECRET_REF),
  tenant: z.union(['feishu', 'lark']).default('feishu'),
  dmMode: z.union(['open', 'allowlist', 'disabled']).default('open'),
  dmAllowlist: z.array(z.string()).default([]),
  groupAllowlist: z.array(z.string()).default([]),
  workspaceMemoryGroups: z.array(z.string()).default([]),
  requireMention: z.boolean().default(true),
  cwd: z.string().default(''),
  provider: z.string().default(''),
  model: z.string().default(''),
  agentProfiles: z.array(agentProfileSchema).default([]),
  defaultAgentProfileId: z.string().default(''),
  defaultInstructions: z.string().default(''),
  defaultAccessBundleIds: z.array(z.string()).default([]),
  groupScopes: z.array(groupScopeSchema).default([]),
})

const PROFILE_ID = /^[a-z][a-z0-9-]{0,62}$/
const MAX_INSTRUCTIONS = 32_000

function validateModelRoute(provider: string | undefined, model: string | undefined, owner: string): void {
  if ((provider === '') !== (model === '')) {
    throw new Error(`deepseek-tag: provider and model overrides for ${owner} must be supplied together`)
  }
}

function validateScopedConfiguration(config: ResolvedConfig): void {
  const profiles = new Set<string>()
  for (const profile of config.agentProfiles) {
    if (!PROFILE_ID.test(profile.id)) {
      throw new Error(`deepseek-tag: invalid Agent profile id ${JSON.stringify(profile.id)}`)
    }
    if (profiles.has(profile.id)) throw new Error(`deepseek-tag: duplicate Agent profile id ${JSON.stringify(profile.id)}`)
    profiles.add(profile.id)
    if (profile.name.trim().length === 0 || profile.name.length > 80) {
      throw new Error(`deepseek-tag: Agent profile ${JSON.stringify(profile.id)} must have a name of at most 80 characters`)
    }
    if ((profile.instructions?.length ?? 0) > MAX_INSTRUCTIONS) {
      throw new Error(`deepseek-tag: Agent profile ${JSON.stringify(profile.id)} instructions are too long`)
    }
    validateModelRoute(profile.provider, profile.model, `Agent profile ${JSON.stringify(profile.id)}`)
  }
  if (config.defaultAgentProfileId !== '' && !profiles.has(config.defaultAgentProfileId)) {
    throw new Error(`deepseek-tag: default Agent profile ${JSON.stringify(config.defaultAgentProfileId)} does not exist`)
  }
  if (config.defaultInstructions.length > MAX_INSTRUCTIONS) {
    throw new Error('deepseek-tag: default instructions are too long')
  }
  const chats = new Set<string>()
  for (const scope of config.groupScopes) {
    const profileId = scope.agentProfileId ?? ''
    if (scope.chatId.trim().length === 0) throw new Error('deepseek-tag: group scope chatId must not be empty')
    if (chats.has(scope.chatId)) throw new Error(`deepseek-tag: duplicate group scope ${JSON.stringify(scope.chatId)}`)
    chats.add(scope.chatId)
    if (profileId !== '' && !profiles.has(profileId)) {
      throw new Error(`deepseek-tag: group scope ${JSON.stringify(scope.chatId)} references unknown Agent profile ${JSON.stringify(profileId)}`)
    }
    if ((scope.instructions?.length ?? 0) > MAX_INSTRUCTIONS) {
      throw new Error(`deepseek-tag: group scope ${JSON.stringify(scope.chatId)} instructions are too long`)
    }
    validateModelRoute(scope.provider, scope.model, `group scope ${JSON.stringify(scope.chatId)}`)
  }
}

/** Apply defaults and reject enabled configurations that cannot connect safely. */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const resolved = Config(config) as ResolvedConfig
  validateModelRoute(resolved.provider, resolved.model, 'the installation')
  validateScopedConfiguration(resolved)
  if (!resolved.enabled) return resolved
  if (!/^cli_[A-Za-z0-9]+$/.test(resolved.appId)) {
    throw new Error('deepseek-tag: enabled appId must be a Feishu/Lark application id beginning with "cli_"')
  }
  if (resolved.dmMode === 'allowlist' && resolved.dmAllowlist.length === 0) {
    throw new Error('deepseek-tag: dmAllowlist must not be empty when dmMode is "allowlist"')
  }
  return resolved
}
