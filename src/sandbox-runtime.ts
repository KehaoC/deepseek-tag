/** Bind every Lark thread to the official Harness sandbox policy seam. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import { effectiveSandboxMode, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-shell'
import type { Session } from '@deepseek-ai/dsh-session'
import type { TagSandboxMode } from './contract.js'

/**
 * Fail closed when a profile replaces either execution family with a bare
 * provider. The standard Harness base profile passes because it mounts
 * dsh-bash-sandbox and dsh-fs-sandbox over the shared sandbox-policy service.
 */
export function assertOfficialSandboxRuntime(ctx: Context): void {
  if (ctx.shell.sandboxMode === undefined) {
    throw new Error('deepseek-tag: the active Harness shell provider is not sandbox-aware')
  }
  if (ctx.fs.sandboxMode === undefined) {
    throw new Error('deepseek-tag: the active Harness filesystem provider is not sandbox-aware')
  }
}

/** Pin one thread's resolved policy before its next model/tool operation. */
export function applyThreadSandboxMode(session: Session, mode: TagSandboxMode): void {
  if (effectiveSandboxMode(session.events) !== mode) setSandboxMode(session, mode)
}
