/**
 * Deepseek Tag: connect DeepSeek Harness agent sessions to Feishu/Lark.
 * @module deepseek-tag
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-agent'
import { DeepseekTagBridge } from './bridge.js'
import { resolveConfig, type Config as ConfigShape } from './config.js'

export { DeepseekTagBridge, productionChannel } from './bridge.js'
export type { BridgeOptions, ChannelLike } from './bridge.js'
export { Config, resolveConfig } from './config.js'
export type { Config as DeepseekTagConfig, ResolvedConfig } from './config.js'
export { finalTurnResult } from './response.js'
export type { TurnResult } from './response.js'
export { conversationScope, createSessionId } from './scope.js'

/** Cordis plugin name used by loader diagnostics and the bundle row. */
export const name = 'deepseek-tag'

/** Agent creation is the only mandatory Harness capability. */
export const inject = ['agents']

/** Resolve the application secret on every plugin activation. */
async function resolveAppSecret(ctx: Context, reference: string): Promise<string | undefined> {
  const ref = credentialRef(reference)
  const provider = ctx.get('credentials')
  if (provider !== undefined) return (await provider.resolve(ref))?.value
  const value = process.env[reference]
  return value === undefined || value.length === 0 ? undefined : value
}

/** Activate one bridge connection for this plugin fiber. */
export async function apply(ctx: Context, config: ConfigShape = {}): Promise<void> {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) {
    ctx.logger.info('[deepseek-tag] disabled; configure the plugin before connecting')
    return
  }
  const appSecret = await resolveAppSecret(ctx, resolved.appSecretEnv)
  if (appSecret === undefined) {
    throw new Error(`deepseek-tag: credential ${JSON.stringify(resolved.appSecretEnv)} is not configured`)
  }
  const bridge = new DeepseekTagBridge(ctx, { config: resolved, appSecret })
  await bridge.start()
  ctx.effect(() => () => bridge.stop(), 'deepseek-tag.serve')
}
