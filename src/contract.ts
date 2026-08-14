/** Settings contract shared by the host plugin and its browser surface. */

/** Feishu China or Lark global service. */
export type LarkTenant = 'feishu' | 'lark'

/** Who may start a direct-message conversation with the bot. */
export type DirectMessageMode = 'open' | 'allowlist' | 'disabled'

export type LarkSetupKind = 'create' | 'authorize'
export type LarkSetupStatus = 'waiting' | 'ready' | 'completed' | 'failed'

/** Reusable logical Agent configuration. It never contains credential values. */
export interface AgentProfileSettings {
  /** Stable slug referenced by Lark scopes. */
  id: string
  /** Admin-facing display name. The Lark bot identity remains app-wide. */
  name: string
  /** Standing guidance installed for new thread sessions using this profile. */
  instructions?: string
  /** Optional Harness provider/model override; both fields must be set together. */
  provider?: string
  model?: string
  /** Workspace template root. Empty follows the Harness process directory. */
  cwd?: string
  /** Capability bundles inherited by every Lark scope using this profile. */
  accessBundleIds?: string[]
}

/** Whether a group requires an initial bot mention or responds automatically. */
export type GroupResponseMode = 'inherit' | 'mention' | 'automatic'

/** One exact Lark group scope beneath the app installation. */
export interface LarkGroupScopeSettings {
  /** Lark group chat_id. */
  chatId: string
  /** Optional admin label used when a chat directory is unavailable. */
  name?: string
  /** Disabled scopes fail closed before an Agent is created. */
  enabled?: boolean
  /** Empty inherits the installation's default profile. */
  agentProfileId?: string
  /** Channel-level instructions appended after profile instructions. */
  instructions?: string
  /** Optional channel-level model override; both fields must be set together. */
  provider?: string
  model?: string
  /** Optional channel-level workspace template override. */
  cwd?: string
  /** Additional bundles combined with installation and profile grants. */
  accessBundleIds?: string[]
  /** Per-channel response behavior. */
  responseMode?: GroupResponseMode
}

/** Secret-free setup state shared with the loopback browser. */
export interface LarkSetupView {
  id: string
  kind: LarkSetupKind
  status: LarkSetupStatus
  url?: string
  expiresAt?: number
  appId?: string
  tenant?: LarkTenant
  error?: string
}

/** Verifiable app-identity grant status shared with the loopback browser. */
export interface LarkPermissionView {
  status: 'ready' | 'missing' | 'unconfigured' | 'unknown'
  grantedScopes: string[]
  missingScopes: string[]
  capabilities: Array<
    | 'appInspection'
    | 'messages'
    | 'directMessages'
    | 'groupHistory'
    | 'chatContext'
    | 'progressCards'
    | 'reactions'
  >
  error?: string
}

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
  /** Group chat ids whose memory is shared across this app workspace. */
  workspaceMemoryGroups?: string[]
  /** Require a direct bot mention for top-level group messages. */
  requireMention?: boolean
  /** Agent working directory. Empty uses the Harness process directory. */
  cwd?: string
  /** Optional Harness LLM provider override. */
  provider?: string
  /** Optional Harness model override. */
  model?: string
  /** Reusable logical Agents selectable by Lark group scopes. */
  agentProfiles?: AgentProfileSettings[]
  /** Default profile for groups without an exact scope override. */
  defaultAgentProfileId?: string
  /** Installation-level standing guidance prepended in every group session. */
  defaultInstructions?: string
  /** Installation-level bundles visible in every admitted group. */
  defaultAccessBundleIds?: string[]
  /** Exact per-group Agent and behavior bindings. */
  groupScopes?: LarkGroupScopeSettings[]
}

/** Credential reference used by a new installation. */
export const DEFAULT_APP_SECRET_REF = 'DEEPSEEK_TAG_LARK_APP_SECRET'

/** Settings namespace owned by both plugin halves. */
export const SETTINGS_NAMESPACE = 'deepseek-tag'
export const WEB_SETTINGS_PATH = '/plugins/deepseek-tag/settings'
