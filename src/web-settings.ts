/** Loopback-only Web configuration transport for an external Harness plugin. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  SettingsConflictError,
  settingsNamespace,
  type SettingsScope,
} from '@deepseek-ai/dsh-settings'
import { Config, resolveConfig, type Config as ConfigShape } from './config.js'
import {
  SETTINGS_NAMESPACE,
  WEB_SETTINGS_PATH,
  type LarkPermissionView,
  type LarkSetupView,
} from './contract.js'
import {
  inspectLarkPermissions,
  LarkSetupManager,
} from './lark-setup.js'

const MAX_BODY_BYTES = 64 * 1024
const namespace = settingsNamespace(SETTINGS_NAMESPACE)

export interface WebSettingsView {
  value: ConfigShape
  revision: number
  writable: boolean
}

export interface WebSetupResponse {
  setup?: LarkSetupView
  permissions?: LarkPermissionView
}

type WebSettingsRequest =
  | { operation: 'describe' }
  | { operation: 'replace'; value: ConfigShape; expectedRevision?: number }
  | { operation: 'setup-create' }
  | { operation: 'setup-authorize' }
  | { operation: 'setup-status'; id: string }
  | { operation: 'setup-cancel'; id: string }
  | { operation: 'setup-finish'; id: string }
  | { operation: 'permissions-check' }

function loopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  const host = req.headers.host
  if (host === undefined) return false
  try {
    return new URL(origin).origin === `http://${host}`
  } catch {
    return false
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function requestOf(value: unknown): WebSettingsRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('request must be an object')
  }
  const input = value as Record<string, unknown>
  if (input.operation === 'describe') return { operation: 'describe' }
  if (input.operation === 'setup-create') return { operation: 'setup-create' }
  if (input.operation === 'setup-authorize') return { operation: 'setup-authorize' }
  if (input.operation === 'permissions-check') return { operation: 'permissions-check' }
  if (input.operation === 'setup-status'
    || input.operation === 'setup-cancel'
    || input.operation === 'setup-finish') {
    if (typeof input.id !== 'string' || input.id.length < 8 || input.id.length > 128) {
      throw new Error('a valid setup session id is required')
    }
    return { operation: input.operation, id: input.id }
  }
  if (input.operation !== 'replace') throw new Error('unknown operation')
  if (typeof input.value !== 'object' || input.value === null || Array.isArray(input.value)) {
    throw new Error('settings value must be an object')
  }
  const config = Config(input.value as ConfigShape)
  resolveConfig(config)
  if (input.expectedRevision !== undefined
    && (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0)) {
    throw new Error('expectedRevision must be a non-negative integer')
  }
  return {
    operation: 'replace',
    value: config,
    ...(input.expectedRevision === undefined
      ? {}
      : { expectedRevision: input.expectedRevision as number }),
  }
}

function viewOf(ctx: Context, scope: SettingsScope<ConfigShape>): WebSettingsView {
  const descriptor = ctx.settings.describe().find(row => row.ns === namespace)
  if (descriptor === undefined) throw new Error('Deepseek Tag settings are unavailable')
  return { value: scope.get(), revision: descriptor.revision, writable: ctx.settings.writable }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

async function mergeSettings(
  ctx: Context,
  scope: SettingsScope<ConfigShape>,
  patch: Partial<ConfigShape>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = viewOf(ctx, scope)
    try {
      await ctx.settings.replace(namespace, Config({ ...current.value, ...patch }), current.revision)
      return
    } catch (error) {
      if (!(error instanceof SettingsConflictError) || attempt === 2) throw error
    }
  }
}

async function permissionView(ctx: Context, scope: SettingsScope<ConfigShape>): Promise<LarkPermissionView> {
  const config = resolveConfig(scope.get())
  if (config.appId === '') {
    return { status: 'unconfigured', granted: [], missing: ['im:message', 'im:message.group_msg'], capabilities: [] }
  }
  const credentials = ctx.get('credentials')
  const resolved = credentials === undefined
    ? process.env[config.appSecretEnv]
    : (await credentials.resolve(credentialRef(config.appSecretEnv)))?.value
  if (resolved === undefined || resolved.length === 0) {
    return { status: 'unconfigured', granted: [], missing: ['im:message', 'im:message.group_msg'], capabilities: [] }
  }
  return inspectLarkPermissions({ appId: config.appId, appSecret: resolved, tenant: config.tenant })
}

/** Register the plugin-owned route without changing Harness's settings allowlist. */
export function installWebSettingsEndpoint(ctx: Context, scope: SettingsScope<ConfigShape>): void {
  const setup = new LarkSetupManager()
  ctx.effect(() => () => setup.close(), 'deepseek-tag: Lark setup sessions')
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: WEB_SETTINGS_PATH,
      async handler(req, res) {
        if (!loopback(req.socket.remoteAddress) || !sameOrigin(req)) {
          json(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        if (req.method !== 'POST'
          || req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
          json(res, 415, { ok: false, error: 'application/json POST required' })
          return
        }
        try {
          const request = requestOf(await readBody(req))
          if (request.operation === 'replace') {
            await webCtx.settings.replace(namespace, request.value, request.expectedRevision)
          } else if (request.operation === 'setup-create') {
            json(res, 200, { ok: true, value: viewOf(webCtx, scope), setup: await setup.startCreate() })
            return
          } else if (request.operation === 'setup-authorize') {
            const appId = resolveConfig(scope.get()).appId
            json(res, 200, {
              ok: true,
              value: viewOf(webCtx, scope),
              setup: await setup.startAuthorization(appId),
            })
            return
          } else if (request.operation === 'setup-status') {
            json(res, 200, { ok: true, value: viewOf(webCtx, scope), setup: setup.describe(request.id) })
            return
          } else if (request.operation === 'setup-cancel') {
            setup.cancel(request.id)
          } else if (request.operation === 'setup-finish') {
            const registration = setup.registration(request.id)
            const current = viewOf(webCtx, scope)
            if (!current.writable) throw new Error('Deepseek Tag settings are read-only')
            const ref = credentialRef(resolveConfig(current.value).appSecretEnv)
            const credentials = webCtx.get('credentials')
            if (credentials === undefined) throw new Error('Harness credential storage is unavailable')
            const info = await credentials.describe(ref)
            if (!info.writable) throw new Error(`credential ${JSON.stringify(ref)} is read-only`)
            // Stop an existing bridge before rotating the shared secret reference.
            await mergeSettings(webCtx, scope, { enabled: false })
            await credentials.set(ref, registration.appSecret)
            await mergeSettings(webCtx, scope, {
              enabled: false,
              appId: registration.appId,
              tenant: registration.tenant,
            })
            setup.complete(request.id)
          } else if (request.operation === 'permissions-check') {
            json(res, 200, {
              ok: true,
              value: viewOf(webCtx, scope),
              permissions: await permissionView(webCtx, scope),
            })
            return
          }
          json(res, 200, { ok: true, value: viewOf(webCtx, scope) })
        } catch (error) {
          if (error instanceof SettingsConflictError) {
            json(res, 409, { ok: false, error: 'settings-conflict' })
            return
          }
          json(res, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    }), 'deepseek-tag: Web settings endpoint')
  })
}
