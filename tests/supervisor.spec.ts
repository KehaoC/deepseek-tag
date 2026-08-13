import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { BridgeSupervisor, type RunningBridge } from '../src/supervisor.js'

describe('bridge supervisor', () => {
  it('keeps the last good connection until a replacement is ready', async () => {
    let secret = 'first-secret'
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const ctx = {
      logger,
      get(service: string) {
        if (service !== 'credentials') return undefined
        return { resolve: vi.fn(async () => ({ value: secret, source: 'test' })) }
      },
    } as unknown as Context
    const bridges: Array<RunningBridge & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = []
    let failNext = false
    const supervisor = new BridgeSupervisor(ctx, {
      createBridge: () => {
        const bridge = {
          start: vi.fn(async () => {
            if (failNext) {
              failNext = false
              throw new Error('cannot connect')
            }
          }),
          stop: vi.fn(async () => undefined),
        }
        bridges.push(bridge)
        return bridge
      },
    })

    await supervisor.configure({ enabled: true, appId: 'cli_test' })
    failNext = true
    await expect(supervisor.configure({ enabled: true, appId: 'cli_test', tenant: 'lark' }))
      .rejects.toThrow('cannot connect')
    expect(bridges[0]?.stop).toHaveBeenCalledOnce()
    expect(bridges[2]?.start).toHaveBeenCalledOnce()

    failNext = false
    secret = 'rotated-secret'
    await supervisor.configure({ enabled: true, appId: 'cli_test' })
    expect(bridges[2]?.stop).toHaveBeenCalledOnce()
    expect(bridges[3]?.start).toHaveBeenCalledOnce()

    await supervisor.stop()
    expect(bridges[3]?.stop).toHaveBeenCalledOnce()
  })
})
