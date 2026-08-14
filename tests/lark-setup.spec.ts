import type { RegisterAppOptions, RegisterAppResult } from '@larksuite/channel'
import { describe, expect, it, vi } from 'vitest'
import {
  inspectLarkPermissions,
  LarkSetupManager,
  REQUIRED_LARK_EVENTS,
  REQUIRED_LARK_SCOPES,
} from '../src/lark-setup.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('LarkSetupManager', () => {
  it('prefills a create-only app and keeps its secret on the host until completion', async () => {
    const result = deferred<RegisterAppResult>()
    let options: RegisterAppOptions | undefined
    const manager = new LarkSetupManager(async input => {
      options = input
      input.onQRCodeReady({ url: 'https://accounts.feishu.cn/setup', expireIn: 600 })
      return result.promise
    })

    const started = await manager.startCreate()
    expect(started).toMatchObject({ kind: 'create', status: 'waiting', url: 'https://accounts.feishu.cn/setup' })
    expect(started).not.toHaveProperty('appSecret')
    expect(options).toMatchObject({
      createOnly: true,
      source: 'deepseek-tag',
      addons: {
        scopes: { tenant: [...REQUIRED_LARK_SCOPES] },
        events: { items: { tenant: [...REQUIRED_LARK_EVENTS] } },
      },
    })

    result.resolve({ client_id: 'cli_created', client_secret: 'secret-value', user_info: { tenant_brand: 'feishu' } })
    await vi.waitFor(() => { expect(manager.describe(started.id).status).toBe('ready') })
    expect(manager.registration(started.id)).toEqual({
      appId: 'cli_created',
      appSecret: 'secret-value',
      tenant: 'feishu',
    })
    expect(manager.complete(started.id).status).toBe('completed')
    expect(() => manager.registration(started.id)).toThrow(/not ready/)
    manager.close()
  })

  it('uses additive authorization for an existing app', async () => {
    const result = deferred<RegisterAppResult>()
    let options: RegisterAppOptions | undefined
    const manager = new LarkSetupManager(async input => {
      options = input
      input.onQRCodeReady({ url: 'https://accounts.feishu.cn/authorize', expireIn: 600 })
      return result.promise
    })
    const started = await manager.startAuthorization('cli_existing')
    expect(options).toMatchObject({ appId: 'cli_existing' })
    expect(options).not.toHaveProperty('createOnly')
    result.resolve({ client_id: 'cli_existing', client_secret: 'rotated' })
    await vi.waitFor(() => { expect(manager.describe(started.id).status).toBe('ready') })
    expect(() => manager.registration(started.id)).toThrow(/not ready/)
    manager.close()
  })
})

describe('inspectLarkPermissions', () => {
  it('reports the exact missing runtime grants', async () => {
    const createChannel = () => ({
      rawClient: {
        application: {
          application: {
            get: async () => ({ data: { app: { scopes: [{ scope: 'im:message' }] } } }),
          },
        },
      },
    })
    const view = await inspectLarkPermissions(
      { appId: 'cli_test', appSecret: 'secret', tenant: 'feishu' },
      createChannel as never,
    )
    expect(view).toEqual({
      status: 'missing',
      grantedScopes: ['im:message'],
      missingScopes: ['im:message.group_msg', 'im:chat:read', 'im:chat.members:read', 'cardkit:card:write'],
      capabilities: ['appInspection', 'messages', 'directMessages', 'reactions'],
    })
  })

  it('verifies the complete least-privilege permission bundle', async () => {
    const createChannel = () => ({
      rawClient: {
        application: {
          application: {
            get: async () => ({ data: { app: { scopes: [
              { scope: 'application:application:self_manage' },
              { scope: 'im:message:readonly' },
              { scope: 'im:message:send_as_bot' },
              { scope: 'im:message.p2p_msg:readonly' },
              { scope: 'im:message.group_msg' },
              { scope: 'im:chat:read' },
              { scope: 'im:chat.members:read' },
              { scope: 'cardkit:card:write' },
              { scope: 'im:message.reactions:write_only' },
            ] } } }),
          },
        },
      },
    })
    const view = await inspectLarkPermissions(
      { appId: 'cli_test', appSecret: 'secret', tenant: 'feishu' },
      createChannel as never,
    )
    expect(view.status).toBe('ready')
    expect(view.capabilities).toEqual([
      'appInspection',
      'messages',
      'directMessages',
      'groupHistory',
      'chatContext',
      'progressCards',
      'reactions',
    ])
    expect(view.missingScopes).toEqual([])
  })
})
