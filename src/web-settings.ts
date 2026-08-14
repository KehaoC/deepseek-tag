/** Loopback-only Web configuration transport for an external Harness plugin. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  SettingsConflictError,
  settingsNamespace,
  type SettingsScope,
} from '@deepseek-ai/dsh-settings'
import { Config, resolveConfig, type Config as ConfigShape } from './config.js'
import { SETTINGS_NAMESPACE, WEB_SETTINGS_PATH } from './contract.js'

const MAX_BODY_BYTES = 64 * 1024
const namespace = settingsNamespace(SETTINGS_NAMESPACE)

export interface WebSettingsView {
  value: ConfigShape
  revision: number
  writable: boolean
}

type WebSettingsRequest =
  | { operation: 'describe' }
  | { operation: 'replace'; value: ConfigShape; expectedRevision?: number }

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

/** Register the plugin-owned route without changing Harness's settings allowlist. */
export function installWebSettingsEndpoint(ctx: Context, scope: SettingsScope<ConfigShape>): void {
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
