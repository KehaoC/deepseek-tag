/**
 * Deepseek Tag: connect DeepSeek Harness agent sessions to Feishu/Lark.
 * @module deepseek-tag
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Config, resolveConfig, type Config as ConfigShape } from './config.js'
import { SETTINGS_NAMESPACE } from './contract.js'
import { BridgeSupervisor, reportReconfigureFailure } from './supervisor.js'

export { DeepseekTagBridge, productionChannel } from './bridge.js'
export type { BridgeOptions, ChannelLike } from './bridge.js'
export { Config, resolveConfig } from './config.js'
export type { Config as DeepseekTagConfig, ResolvedConfig } from './config.js'
export { finalTurnResult } from './response.js'
export type { TurnResult } from './response.js'
export { conversationScope, createSessionId } from './scope.js'
export { BridgeSupervisor } from './supervisor.js'
export type { RunningBridge, SupervisorOptions } from './supervisor.js'

/** Cordis plugin name used by loader diagnostics and the bundle row. */
export const name = 'deepseek-tag'

/** Agent creation is the only mandatory Harness capability. */
export const inject = ['agents']

/** Activate the composition layer and optional live Web UI settings layer. */
export async function apply(ctx: Context, config: ConfigShape = {}): Promise<void> {
  let current: () => ConfigShape = () => config
  const supervisor = new BridgeSupervisor(ctx)
  if (!resolveConfig(config).enabled) {
    ctx.logger.info('[deepseek-tag] disabled; configure the plugin before connecting')
  }
  await supervisor.configure(config)
  ctx.effect(() => () => supervisor.stop(), 'deepseek-tag.serve')

  const reconfigure = (): void => {
    void supervisor.configure(current()).catch(error => { reportReconfigureFailure(ctx, error) })
  }
  installSettingsSection(ctx, settingsNamespace(SETTINGS_NAMESPACE), Config, config, {
    setSource(source) { current = source },
    onChange: reconfigure,
    validate: resolveConfig,
  })
  ctx.on('credentials/updated', (ref) => {
    if (ref === resolveConfig(current()).appSecretEnv) reconfigure()
  })
}
