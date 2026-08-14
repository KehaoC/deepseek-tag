/** Durable behavior snapshots for Claude Tag-style Lark thread sessions. */

import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { ResolvedAgentBehavior } from './agent-scope.js'

const behaviorSchema = z.object({
  profileId: z.string().min(1),
  profileName: z.string().min(1),
  instructions: z.string(),
  provider: z.string().min(1),
  model: z.string().min(1),
  cwd: z.string().min(1),
  requireMention: z.boolean(),
})

const snapshotSchema = z.object({
  behavior: behaviorSchema,
  createdAt: z.string(),
})

export type ThreadAgentBehavior = z.infer<typeof behaviorSchema>
export type ThreadConfigSnapshot = z.infer<typeof snapshotSchema>

/** Session ids are already opaque hashes; no raw Lark id enters this domain. */
export const threadConfigDomainSpec = defineDomain({
  name: 'deepseek_tag_thread_config',
  version: 1,
  tables: {
    snapshots: domainTable<string, ThreadConfigSnapshot>(snapshotSchema),
  },
})

/** Keep user-authored double braces literal under Harness's strict prompt templates. */
export function literalPromptText(value: string): string {
  return value.replaceAll('{{', '{\u200B{')
}

/** Materialize deployment defaults before freezing a thread's behavior. */
export function materializeThreadBehavior(
  behavior: ResolvedAgentBehavior,
  defaultModel: { provider: string; model: string },
  processCwd: string,
): ThreadAgentBehavior {
  return {
    profileId: behavior.profileId,
    profileName: behavior.profileName,
    instructions: behavior.instructions,
    provider: behavior.provider || defaultModel.provider,
    model: behavior.model || defaultModel.model,
    cwd: behavior.cwd || processCwd,
    requireMention: behavior.requireMention,
  }
}

/**
 * One opened thread-config domain. Existing sessions retain their first
 * behavior snapshot; a genuinely new session overwrites any orphaned record.
 */
export class TagThreadConfigStore {
  constructor(
    private readonly table: KvTable<string, ThreadConfigSnapshot>,
    private readonly domain?: Domain<typeof threadConfigDomainSpec>,
  ) {}

  static async open(ctx: Context): Promise<TagThreadConfigStore> {
    const domain = await ctx.storageDomain.open(threadConfigDomainSpec)
    return new TagThreadConfigStore(domain.table('snapshots'), domain)
  }

  close(): Promise<void> {
    return this.domain?.close() ?? Promise.resolve()
  }

  /** Resolve and durably establish the behavior used for this activation. */
  async resolve(key: string, current: ThreadAgentBehavior, resume: boolean): Promise<ThreadAgentBehavior> {
    const existing = resume ? this.table.get(key) : undefined
    if (existing !== undefined) return structuredClone(existing.behavior)
    const snapshot: ThreadConfigSnapshot = {
      behavior: structuredClone(current),
      createdAt: new Date().toISOString(),
    }
    await this.table.put(key, snapshot)
    return structuredClone(snapshot.behavior)
  }
}
