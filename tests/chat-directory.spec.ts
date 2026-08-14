import { describe, expect, it, vi } from 'vitest'
import { listKnownChats } from '../src/chat-directory.js'

describe('Lark chat directory', () => {
  it('uses the bounded SDK listing contract and returns stable unique groups', async () => {
    const listChats = vi.fn().mockResolvedValue([
      { id: ' oc_two ', name: ' Zeta ' },
      { id: 'oc_one', name: 'Alpha' },
      { id: 'oc_two', name: 'Duplicate' },
      { id: ' ', name: 'Invalid' },
    ])

    await expect(listKnownChats({ listChats })).resolves.toEqual([
      { chatId: 'oc_one', name: 'Alpha' },
      { chatId: 'oc_two', name: 'Zeta' },
    ])
    expect(listChats).toHaveBeenCalledWith({ pageSize: 100, maxPages: 10 })
  })
})
