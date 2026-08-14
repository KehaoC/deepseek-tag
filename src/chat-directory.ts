import type { ChatSummary } from '@larksuite/channel'
import type { LarkChatDirectoryEntry } from './contract.js'

/** Public SDK seam needed to discover groups without opening another WebSocket. */
export interface ChatDirectoryChannel {
  listChats(options?: { pageSize?: number; maxPages?: number }): Promise<ChatSummary[]>
}

/** Fetch, normalize, deduplicate, and sort groups visible to the configured bot. */
export async function listKnownChats(channel: ChatDirectoryChannel): Promise<LarkChatDirectoryEntry[]> {
  const chats = await channel.listChats({ pageSize: 100, maxPages: 10 })
  const unique = new Map<string, LarkChatDirectoryEntry>()
  for (const chat of chats) {
    const chatId = chat.id.trim()
    if (chatId === '' || unique.has(chatId)) continue
    unique.set(chatId, { chatId, name: chat.name.trim() })
  }
  return [...unique.values()].sort((left, right) => (
    (left.name || left.chatId).localeCompare(right.name || right.chatId)
  ))
}
