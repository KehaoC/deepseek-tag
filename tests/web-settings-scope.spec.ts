import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: <T>(initial: T) => {
    let value = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: (next: T) => {
        value = next
        for (const listener of listeners) listener()
      },
    }
  },
}))

import { WebTagSettingsScope } from '../src/client/controller.js'
import { formOf } from '../src/client/controller.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('WebTagSettingsScope', () => {
  it('materializes and clones scoped Agent configuration', () => {
    const value = {
      agentProfiles: [{ id: 'engineer', name: 'Engineer', accessBundleIds: ['github'] }],
      defaultAgentProfileId: 'engineer',
      defaultInstructions: 'Be precise.',
      defaultAccessBundleIds: ['baseline'],
      groupScopes: [{ chatId: 'oc_one', accessBundleIds: ['write'] }],
    }
    const form = formOf(value)
    expect(form).toMatchObject(value)
    form.agentProfiles[0]?.accessBundleIds?.push('changed')
    form.groupScopes[0]?.accessBundleIds?.push('changed')
    expect(value.agentProfiles[0]?.accessBundleIds).toEqual(['github'])
    expect(value.groupScopes[0]?.accessBundleIds).toEqual(['write'])
  })

  it('loads and replaces settings through the plugin-owned endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        value: { value: { enabled: false }, revision: 0, writable: true },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        value: { value: { enabled: false, appId: 'cli_test' }, revision: 1, writable: true },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const scope = new WebTagSettingsScope(true)
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    expect(scope.getSnapshot().revision).toBe(0)

    await expect(scope.replace({ enabled: false, appId: 'cli_test' }, 0)).resolves.toBe(true)
    expect(scope.getSnapshot()).toMatchObject({
      value: { enabled: false, appId: 'cli_test' },
      revision: 1,
      writable: true,
    })
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      operation: 'replace',
      value: { enabled: false, appId: 'cli_test' },
      expectedRevision: 0,
    })
  })
})
