import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { applyThreadSandboxMode, assertOfficialSandboxRuntime } from '../src/sandbox-runtime.js'

function session(): Session {
  const events: SessionEvent[] = []
  return {
    events,
    append(type: SessionEvent['type'], data: unknown) {
      events.push({ type, seq: events.length, time: events.length, data } as SessionEvent)
    },
  } as unknown as Session
}

describe('official Harness sandbox binding', () => {
  it('fails closed when shell or filesystem mutations are not sandbox-aware', () => {
    expect(() => assertOfficialSandboxRuntime({
      shell: { sandboxMode: undefined },
      fs: { sandboxMode: 'workspace-write' },
    } as unknown as Context)).toThrow(/shell provider/)
    expect(() => assertOfficialSandboxRuntime({
      shell: { sandboxMode: 'workspace-write' },
      fs: { sandboxMode: undefined },
    } as unknown as Context)).toThrow(/filesystem provider/)
    expect(() => assertOfficialSandboxRuntime({
      shell: { sandboxMode: 'workspace-write' },
      fs: { sandboxMode: 'workspace-write' },
    } as unknown as Context)).not.toThrow()
  })

  it('pins a thread mode once and records a later explicit change', () => {
    const value = session()
    applyThreadSandboxMode(value, 'workspace-write')
    applyThreadSandboxMode(value, 'workspace-write')
    applyThreadSandboxMode(value, 'read-only')
    expect(value.events.filter(event => event.type === 'sandbox/mode').map(event => event.data)).toEqual([
      { mode: 'workspace-write' },
      { mode: 'read-only' },
    ])
  })
})
