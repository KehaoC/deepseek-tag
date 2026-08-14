import { describe, expect, it } from 'vitest'
import { ConversationQueue } from '../src/conversation-queue.js'

describe('ConversationQueue', () => {
  it('serializes one thread without blocking a sibling topic', async () => {
    const queue = new ConversationQueue()
    const events: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })

    const first = queue.run('topic-a', async () => {
      events.push('a1:start')
      await firstGate
      events.push('a1:end')
    })
    const second = queue.run('topic-a', async () => { events.push('a2') })
    const sibling = queue.run('topic-b', async () => { events.push('b1') })

    await sibling
    expect(events).toEqual(['a1:start', 'b1'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['a1:start', 'b1', 'a1:end', 'a2'])
  })
})
