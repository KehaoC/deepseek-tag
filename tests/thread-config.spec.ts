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
  profileId: 'engineer',
  profileName: 'Engineer',
  instructions: 'Use {{model}} literally.',
  provider: 'provider-one',
  model: 'model-one',
  cwd: '/one',
  requireMention: true,
}

describe('thread Agent configuration', () => {
  it('freezes existing session behavior and replaces orphaned snapshots for new sessions', async () => {
    const store = new TagThreadConfigStore(table())
    await expect(store.resolve('session', first, false)).resolves.toEqual(first)
    const changed = { ...first, model: 'model-two', cwd: '/two' }
    await expect(store.resolve('session', changed, true)).resolves.toEqual(first)
    await expect(store.resolve('session', changed, false)).resolves.toEqual(changed)
  })

  it('materializes deployment defaults and neutralizes prompt template groups', () => {
    expect(materializeThreadBehavior({
      enabled: true,
      kind: 'group',
      profileId: 'default',
      profileName: 'Default Agent',
      instructions: '',
      provider: '',
      model: '',
      cwd: '',
      requireMention: true,
      accessBundleIds: [],
    }, { provider: 'default-provider', model: 'default-model' }, '/runtime')).toMatchObject({
      provider: 'default-provider', model: 'default-model', cwd: '/runtime',
    })
    expect(literalPromptText('keep {{model}} literal')).toBe('keep {\u200B{model}} literal')
  })
})
