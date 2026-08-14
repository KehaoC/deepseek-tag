import { describe, expect, it } from 'vitest'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  literalPromptText,
  materializeThreadBehavior,
  TagThreadConfigStore,
  type ThreadConfigSnapshot,
} from '../src/thread-config.js'

function table(): KvTable<string, ThreadConfigSnapshot> {
  const records = new Map<string, ThreadConfigSnapshot>()
  return {
    get: key => records.get(key),
    entries: () => records.entries(),
    keys: () => records.keys(),
    get size() { return records.size },
    async put(key, value) { records.set(key, structuredClone(value)) },
    async delete(key) { return records.delete(key) },
    async update(key, fn) {
      const current = records.get(key)
      if (current === undefined) throw new Error('missing')
      const next = fn(current)
      records.set(key, next)
      return next
    },
  }
}

const first = {
  scopeName: 'Engineering',
  instructions: 'Use {{model}} literally.',
  provider: 'provider-one',
  model: 'model-one',
  cwd: '/one',
  requireMention: true,
}

describe('thread scope configuration', () => {
  it('freezes existing session behavior and replaces orphaned snapshots for new sessions', async () => {
    const store = new TagThreadConfigStore(table())
    await expect(store.resolve('session', first, false)).resolves.toEqual(first)
    const changed = { ...first, model: 'model-two', cwd: '/two' }
    await expect(store.resolve('session', changed, true)).resolves.toEqual(first)
    await expect(store.resolve('session', changed, false)).resolves.toEqual(changed)
  })

  it('resumes legacy snapshots without restoring the removed Agent-profile setting layer', async () => {
    const legacyTable = table()
    await legacyTable.put('legacy', {
      behavior: {
        profileId: 'engineer',
        profileName: 'Engineering',
        instructions: 'Legacy frozen instructions.',
        provider: 'provider-one',
        model: 'model-one',
        cwd: '/one',
        requireMention: true,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const store = new TagThreadConfigStore(legacyTable)
    await expect(store.resolve('legacy', { ...first, model: 'model-two' }, true)).resolves.toEqual({
      scopeName: 'Engineering',
      instructions: 'Legacy frozen instructions.',
      provider: 'provider-one',
      model: 'model-one',
      cwd: '/one',
      requireMention: true,
    })
  })

  it('materializes deployment defaults and neutralizes prompt template groups', () => {
    expect(materializeThreadBehavior({
      enabled: true,
      kind: 'group',
      scopeName: 'Workspace default',
      instructions: '',
      provider: '',
      model: '',
      cwd: '',
      requireMention: true,
    }, { provider: 'default-provider', model: 'default-model' }, '/runtime')).toMatchObject({
      provider: 'default-provider', model: 'default-model', cwd: '/runtime',
    })
    expect(literalPromptText('keep {{model}} literal')).toBe('keep {\u200B{model}} literal')
  })
})
