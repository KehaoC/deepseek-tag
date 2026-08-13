/** Deepseek Tag deployment configuration and loader-visible schema. */

import z from '@deepseek-ai/schemastery'

/** Feishu China or Lark global service. */
export type LarkTenant = 'feishu' | 'lark'

/** Who may start a direct-message conversation with the bot. */
export type DirectMessageMode = 'open' | 'allowlist' | 'disabled'

/** Plugin configuration supplied by the profile composition. */
export interface Config {
  /** Whether the bridge should connect. Disabled installs stay inert. */
  enabled?: boolean
  /** Feishu/Lark application id (`cli_...`). */
  appId?: string
  /** Harness credential reference holding the application secret. */
  appSecretEnv?: string
  /** Regional platform whose API the application belongs to. */
  tenant?: LarkTenant
  /** Direct-message admission policy. */
  dmMode?: DirectMessageMode
  /** Sender ids admitted when `dmMode` is `allowlist`. */
  dmAllowlist?: string[]
  /** Group chat ids admitted to use the bot; empty admits every group. */
  groupAllowlist?: string[]
  /** Require a direct bot mention for top-level group messages. */
  requireMention?: boolean
  /** Agent working directory. Empty uses the Harness process directory. */
  cwd?: string
  /** Optional Harness LLM provider override. */
  provider?: string
  /** Optional Harness model override. */
  model?: string
}

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
  appSecretEnv: z.string().role('credential-ref').default('DEEPSEEK_TAG_LARK_APP_SECRET'),
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
