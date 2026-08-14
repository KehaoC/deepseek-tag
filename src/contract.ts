/** Settings contract shared by the host plugin and its browser surface. */

/** Feishu China or Lark global service. */
export type LarkTenant = 'feishu' | 'lark'

/** Who may start a direct-message conversation with the bot. */
export type DirectMessageMode = 'open' | 'allowlist' | 'disabled'

/** Plugin configuration supplied by composition and the settings document. */
export interface DeepseekTagSettings {
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

/** Credential reference used by a new installation. */
export const DEFAULT_APP_SECRET_REF = 'DEEPSEEK_TAG_LARK_APP_SECRET'

/** Settings namespace owned by both plugin halves. */
export const SETTINGS_NAMESPACE = 'deepseek-tag'
export const WEB_SETTINGS_PATH = '/plugins/deepseek-tag/settings'
