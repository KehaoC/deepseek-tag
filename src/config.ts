/** Deepseek Tag deployment configuration and loader-visible schema. */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_APP_SECRET_REF,
  type DeepseekTagSettings,
  type DirectMessageMode,
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
  requireMention: boolean
  cwd: string
  provider: string
  model: string
}

/** Loader-visible schema. Secrets remain in the credential provider, not this section. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  appId: z.string().default(''),
  appSecretEnv: z.string().role('credential-ref').default(DEFAULT_APP_SECRET_REF),
  tenant: z.union(['feishu', 'lark']).default('feishu'),
  dmMode: z.union(['open', 'allowlist', 'disabled']).default('open'),
  dmAllowlist: z.array(z.string()).default([]),
  groupAllowlist: z.array(z.string()).default([]),
  requireMention: z.boolean().default(true),
  cwd: z.string().default(''),
  provider: z.string().default(''),
  model: z.string().default(''),
})

/** Apply defaults and reject enabled configurations that cannot connect safely. */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const resolved = Config(config) as ResolvedConfig
  if (!resolved.enabled) return resolved
  if (!/^cli_[A-Za-z0-9]+$/.test(resolved.appId)) {
    throw new Error('deepseek-tag: enabled appId must be a Feishu/Lark application id beginning with "cli_"')
  }
  if (resolved.dmMode === 'allowlist' && resolved.dmAllowlist.length === 0) {
    throw new Error('deepseek-tag: dmAllowlist must not be empty when dmMode is "allowlist"')
  }
  return resolved
}
