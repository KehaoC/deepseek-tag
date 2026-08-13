/** Live bridge replacement driven by the Harness settings and credential seams. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { deepEqualJson } from '@deepseek-ai/dsh-settings'
import { DeepseekTagBridge } from './bridge.js'
import { resolveConfig, type Config, type ResolvedConfig } from './config.js'

/** Running bridge surface used by the production factory and lifecycle tests. */
export interface RunningBridge {
  start(): Promise<void>
  stop(): Promise<void>
}

/** Supervisor construction seams. */
export interface SupervisorOptions {
  createBridge?: (config: ResolvedConfig, appSecret: string) => RunningBridge
}

interface ActiveBridge {
  bridge: RunningBridge
  config: ResolvedConfig
  appSecret: string
}

/** Stable error text for diagnostics regardless of the thrown shape. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve one credential without ever placing it in a settings document. */
async function resolveAppSecret(ctx: Context, reference: string): Promise<string | undefined> {
  const ref = credentialRef(reference)
  const provider = ctx.get('credentials')
  if (provider !== undefined) return (await provider.resolve(ref))?.value
  const value = process.env[reference]
  return value === undefined || value.length === 0 ? undefined : value
}

/**
 * Serialize configuration generations and swap only after a replacement has
 * connected. A rejected generation leaves the last good bridge serving.
 */
export class BridgeSupervisor {
  private active: ActiveBridge | undefined
  private tail: Promise<void> = Promise.resolve()
  private generation = 0
  private disposed = false

  constructor(private readonly ctx: Context, private readonly options: SupervisorOptions = {}) {}

  /** Apply one authoritative settings snapshot. */
  configure(config: Config): Promise<void> {
    const generation = ++this.generation
    const task = this.tail.then(async () => {
      if (this.disposed || generation !== this.generation) return
      await this.replace(config, generation)
    })
    this.tail = task.catch(() => undefined)
    return task
  }

  /** Stop future replacements, drain the queue, and release the active bridge. */
  async stop(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    await this.tail
    const active = this.active
    this.active = undefined
    await active?.bridge.stop()
  }

  private async replace(input: Config, generation: number): Promise<void> {
    const config = resolveConfig(input)
    if (!config.enabled) {
      const active = this.active
      this.active = undefined
      await active?.bridge.stop()
      return
    }
    const appSecret = await resolveAppSecret(this.ctx, config.appSecretEnv)
    if (appSecret === undefined) {
      throw new Error(`deepseek-tag: credential ${JSON.stringify(config.appSecretEnv)} is not configured`)
    }
    if (this.active !== undefined
      && deepEqualJson(this.active.config, config)
      && this.active.appSecret === appSecret) return

    const bridge = (this.options.createBridge
      ?? ((nextConfig, nextSecret) => new DeepseekTagBridge(this.ctx, {
        config: nextConfig,
        appSecret: nextSecret,
      })))(config, appSecret)
    try {
      await bridge.start()
    } catch (error) {
      await bridge.stop().catch(() => undefined)
      throw error
    }
    if (this.disposed || generation !== this.generation) {
      await bridge.stop()
      return
    }
    const previous = this.active
    this.active = { bridge, config, appSecret }
    await previous?.bridge.stop()
  }
}

/** Report a live reconfiguration failure without stopping the plugin fiber. */
export function reportReconfigureFailure(ctx: Context, error: unknown): void {
  ctx.logger.error('[deepseek-tag] keeping the last good connection: %s', messageOf(error))
}
