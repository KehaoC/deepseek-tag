/**
 * Deepseek Tag: connect DeepSeek Harness agent sessions to Feishu/Lark.
 * @module deepseek-tag
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Config, resolveConfig, type Config as ConfigShape } from './config.js'
import { SETTINGS_NAMESPACE } from './contract.js'
import { TagMemoryStore } from './memory.js'
import { BridgeSupervisor, reportReconfigureFailure } from './supervisor.js'
import { installWebSettingsEndpoint } from './web-settings.js'

export { admitsConversationMessage, DeepseekTagBridge, productionChannel, resolveTopicThread } from './bridge.js'
export type { BridgeOptions, ChannelLike } from './bridge.js'
export { Config, resolveConfig } from './config.js'
export type { Config as DeepseekTagConfig, ResolvedConfig } from './config.js'
export { ConversationQueue } from './conversation-queue.js'
export { finalTurnResult } from './response.js'
export type { TurnResult } from './response.js'
export {
  finalizeRunCardState,
  initialRunCardState,
  ManagedRunCard,
  reduceRunCardState,
  renderRunCard,
  runCardNeedsContinuation,
} from './run-card.js'
export type { ManagedCardChannel, RunCardState, RunTool } from './run-card.js'
export {
  renderInitialThreadContext,
  supportsHistory,
  TagHistoryAccess,
} from './history.js'
export type { HistoryChannel, HistoryMessage } from './history.js'
export { TagMemoryStore, memoryDomainSpec } from './memory.js'
export type { MemoryNote } from './memory.js'
export { conversationPlace, conversationScope, createSessionId } from './scope.js'
export type { ConversationPlace, MemoryAccess } from './scope.js'
export { BridgeSupervisor } from './supervisor.js'
export type { RunningBridge, SupervisorOptions } from './supervisor.js'

/** Cordis plugin name used by loader diagnostics and the bundle row. */
export const name = 'deepseek-tag'

/** Core Harness capabilities required by the bridge and its configuration plane. */
export const inject = [
  'agentDefaultModel',
  'agents',
  'sessionPersistence',
  'settings',
  'storageDomain',
  'systemPrompt',
  'tools',
]

/** Activate the composition layer and optional live Web UI settings layer. */
export async function apply(ctx: Context, config: ConfigShape = {}): Promise<void> {
  const memory = await TagMemoryStore.open(ctx)
  ctx.effect(() => () => memory.close(), 'deepseek-tag.memory')
  const supervisor = new BridgeSupervisor(ctx, { memory })
  if (!resolveConfig(config).enabled) {
    ctx.logger.info('[deepseek-tag] disabled; configure the plugin before connecting')
  }
  ctx.effect(() => () => supervisor.stop(), 'deepseek-tag.serve')

  const reconfigure = (): void => {
    void supervisor.configure(scope.get()).catch(error => { reportReconfigureFailure(ctx, error) })
  }
  const scope = ctx.settings.register(settingsNamespace(SETTINGS_NAMESPACE), Config, {
    base: config,
    validate: resolveConfig,
  })
  installWebSettingsEndpoint(ctx, scope)
  scope.watch(reconfigure)
  ctx.on('credentials/updated', (ref) => {
    if (ref === resolveConfig(scope.get()).appSecretEnv) reconfigure()
  })
  reconfigure()
}
