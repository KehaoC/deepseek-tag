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

import { formOf, validateForm, WebTagSettingsScope } from '../src/client/controller.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('WebTagSettingsScope', () => {
  it('materializes and clones scope-first configuration', () => {
    const value = {
      defaultInstructions: 'Be precise.',
      sandboxMode: 'workspace-write' as const,
      groupScopes: [{ chatId: 'oc_one', instructions: 'Channel guidance.', sandboxMode: 'read-only' as const }],
    }
    const form = formOf(value)
    expect(form).toMatchObject(value)
    if (form.groupScopes[0] !== undefined) form.groupScopes[0].instructions = 'Changed'
    expect(value.groupScopes[0]?.instructions).toBe('Channel guidance.')
  })

  it('rejects incomplete or duplicate channel scope edits before save', () => {
    const form = formOf(undefined)
    form.groupScopes = [{ chatId: 'oc_one', provider: 'provider-only' }]
    expect(validateForm(form)).toBe('channelScopes')
    form.groupScopes = [{ chatId: 'oc_one' }, { chatId: 'oc_one' }]
    expect(validateForm(form)).toBe('channelScopes')
    form.groupScopes = [{ chatId: 'oc_one', provider: 'provider', model: 'model' }]
    expect(validateForm(form)).toBeUndefined()
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
