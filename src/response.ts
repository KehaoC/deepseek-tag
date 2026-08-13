/** Project one finished Harness turn into a Lark-safe final response. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** User-facing result of one agent turn. */
export type TurnResult =
  | { kind: 'reply'; text: string }
  | { kind: 'empty' }
  | { kind: 'failed' }

/** Concatenate the visible text blocks of an assistant message. */
function messageText(event: Extract<SessionEvent, { type: 'assistant/message' }>): string {
  return event.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
}

/** Select the last visible assistant message in the last turn that ended. */
export function finalTurnResult(events: readonly SessionEvent[]): TurnResult {
  const end = events.findLast(event => event.type === 'turn/end')
  if (end === undefined || end.type !== 'turn/end') return { kind: 'failed' }
  const messages = events.filter(
    (event): event is Extract<SessionEvent, { type: 'assistant/message' }> =>
      event.type === 'assistant/message' && event.data.turn === end.data.turn,
  )
  const text = messages.map(messageText).findLast(value => value.length > 0)
  if (text !== undefined) return { kind: 'reply', text }
  return end.data.reason.kind === 'completed' ? { kind: 'empty' } : { kind: 'failed' }
}
