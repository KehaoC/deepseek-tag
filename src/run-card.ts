/** Live Harness run projection rendered as a managed Lark CardKit card. */

import type { SessionEvent, TodoItem } from '@deepseek-ai/dsh-session'
import type { NormalizedMessage } from '@larksuite/channel'

const MAX_VISIBLE_TEXT = 5_000
const MAX_TODOS = 16
const MAX_TOOLS = 16

type RunTerminal = 'running' | 'done' | 'error'
type ToolStatus = 'running' | 'done' | 'error'

export interface RunTool {
  callId: string
  name: string
  status: ToolStatus
}

export interface RunCardState {
  text: string
  textBoundary: boolean
  streamedSteps: string[]
  todos: TodoItem[]
  tools: RunTool[]
  terminal: RunTerminal
}

export const initialRunCardState: RunCardState = {
  text: '',
  textBoundary: false,
  streamedSteps: [],
  todos: [],
  tools: [],
  terminal: 'running',
}

function stepKey(turn: number, step: number): string {
  return `${String(turn)}:${String(step)}`
}

function visibleAssistantText(event: SessionEvent<'assistant/message'>): string {
  return event.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Fold the public Harness session firehose into user-visible run state. */
export function reduceRunCardState(state: RunCardState, event: SessionEvent): RunCardState {
  switch (event.type) {
    case 'assistant/chunk': {
      if (event.data.chunk.type !== 'text-delta') return state
      const key = stepKey(event.data.turn, event.data.step)
      return {
        ...state,
        text: state.text + (state.textBoundary && state.text.length > 0 ? '\n\n' : '') + event.data.chunk.text,
        textBoundary: false,
        streamedSteps: state.streamedSteps.includes(key)
          ? state.streamedSteps
          : [...state.streamedSteps, key],
      }
    }
    case 'assistant/message': {
      const key = stepKey(event.data.turn, event.data.step)
      if (state.streamedSteps.includes(key)) return state
      const text = visibleAssistantText(event)
      return text.length === 0 ? state : {
        ...state,
        text: state.text + (state.textBoundary && state.text.length > 0 ? '\n\n' : '') + text,
        textBoundary: false,
      }
    }
    case 'tool/call':
      return {
        ...state,
        textBoundary: true,
        tools: [...state.tools, {
          callId: event.data.callId,
          name: event.data.name,
          status: 'running',
        }],
      }
    case 'tool/result':
      return {
        ...state,
        tools: state.tools.map(tool => tool.callId === event.data.message.source.callId
          ? { ...tool, status: event.data.message.content[0].isError || event.data.error !== undefined ? 'error' : 'done' }
          : tool),
      }
    case 'todo/write':
      return { ...state, todos: [...event.data.todos] }
    case 'turn/end':
      return {
        ...state,
        terminal: event.data.reason.kind === 'completed' ? 'done' : 'error',
      }
    default:
      return state
  }
}

/** Close a run even when a provider emitted no raw chunks. */
export function finalizeRunCardState(
  state: RunCardState,
  finalText: string | undefined,
  failed = false,
): RunCardState {
  const text = state.text.length > 0 || finalText === undefined ? state.text : finalText
  return { ...state, text, terminal: failed ? 'error' : 'done' }
}

/** Long answers continue as SDK-chunked markdown after the bounded live card. */
export function runCardNeedsContinuation(state: RunCardState): boolean {
  return state.text.length > MAX_VISIBLE_TEXT
}

function bounded(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n\n_内容较长，已在进度卡片中截断。_`
}

function checklist(todos: readonly TodoItem[]): string {
  return todos.slice(0, MAX_TODOS).map(todo => {
    const icon = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⬜'
    return `${icon} ${bounded(todo.content.replace(/\s+/g, ' ').trim(), 240)}`
  }).join('\n')
}

function toolList(tools: readonly RunTool[]): string {
  return tools.slice(-MAX_TOOLS).map(tool => {
    const icon = tool.status === 'done' ? '✅' : tool.status === 'error' ? '❌' : '⏳'
    return `${icon} **${bounded(tool.name.replace(/\s+/g, ' ').trim(), 120)}**`
  }).join('\n')
}

function panel(title: string, content: string, expanded: boolean): object {
  return {
    tag: 'collapsible_panel',
    expanded,
    header: {
      title: { tag: 'markdown', content: title },
      vertical_align: 'center',
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
      icon_position: 'follow_text',
      icon_expanded_angle: -180,
    },
    border: { color: 'grey', corner_radius: '6px' },
    vertical_spacing: '8px',
    padding: '8px 10px 8px 10px',
    elements: [{ tag: 'markdown', content, text_size: 'notation' }],
  }
}

/** Render only model-visible text plus redacted tool names/statuses. */
export function renderRunCard(state: RunCardState): object {
  const elements: object[] = [{
    tag: 'markdown',
    content: state.terminal === 'running' ? '🐋 **收到，我来处理。**' : '🐋 **Deepseek Tag**',
  }]
  if (state.todos.length > 0) {
    const complete = state.todos.filter(todo => todo.status === 'completed').length
    elements.push(panel(`**任务进度 · ${String(complete)}/${String(state.todos.length)}**`, checklist(state.todos), true))
  }
  if (state.tools.length > 0) {
    const running = state.tools.some(tool => tool.status === 'running')
    elements.push(panel(`**工具调用 · ${String(state.tools.length)}**`, toolList(state.tools), running))
  }
  if (state.text.trim().length > 0) {
    elements.push({ tag: 'markdown', content: bounded(state.text, MAX_VISIBLE_TEXT) })
  }
  if (state.terminal === 'running') {
    const status = state.tools.some(tool => tool.status === 'running')
      ? '🧰 正在调用工具'
      : state.text.length > 0 ? '✍️ 正在输出' : '🧠 正在思考'
    elements.push({ tag: 'markdown', content: status, text_size: 'notation' })
  } else if (state.terminal === 'error') {
    elements.push({ tag: 'markdown', content: '⚠️ 本次任务未能完成，请检查 DeepSeek Harness 日志。', text_size: 'notation' })
  } else if (state.text.trim().length === 0) {
    elements.push({ tag: 'markdown', content: '_任务已完成，但没有返回文本内容。_', text_size: 'notation' })
  }
  return {
    schema: '2.0',
    config: {
      streaming_mode: state.terminal === 'running',
      summary: { content: state.terminal === 'running' ? 'Deepseek Tag 正在处理' : 'Deepseek Tag 已完成' },
      ...(state.terminal === 'running' ? {
        streaming_config: {
          print_frequency_ms: { default: 70 },
          print_step: { default: 1 },
          print_strategy: 'fast',
        },
      } : {}),
    },
    body: { elements },
  }
}

export interface ManagedCardChannel {
  createCard(card: object): Promise<{ cardId: string }>
  send(
    to: string,
    input: { cardId: string },
    options: { replyTo: string; replyInThread: boolean },
  ): Promise<{ messageId: string }>
  updateCardById(cardId: string, card: object, sequence: number): Promise<void>
}

/** A throttled, ordered CardKit entity lifecycle for one Agent turn. */
export class ManagedRunCard {
  private sequence = 0
  private desired: object | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private tail: Promise<void> = Promise.resolve()
  private failed = false

  private constructor(
    private readonly channel: ManagedCardChannel,
    private readonly cardId: string,
    readonly messageId: string,
    private readonly onError: (error: unknown) => void,
  ) {}

  static async open(
    channel: ManagedCardChannel,
    message: NormalizedMessage,
    state: RunCardState,
    onError: (error: unknown) => void,
  ): Promise<ManagedRunCard> {
    const { cardId } = await channel.createCard(renderRunCard(state))
    const { messageId } = await channel.send(message.chatId, { cardId }, {
      replyTo: message.messageId,
      replyInThread: message.threadId !== undefined,
    })
    return new ManagedRunCard(channel, cardId, messageId, onError)
  }

  get healthy(): boolean {
    return !this.failed
  }

  update(state: RunCardState): void {
    if (this.failed) return
    this.desired = renderRunCard(state)
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.enqueueDesired()
    }, 180)
    this.timer.unref()
  }

  async finish(state: RunCardState): Promise<void> {
    this.desired = renderRunCard(state)
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.enqueueDesired()
    await this.tail
  }

  private enqueueDesired(): void {
    if (this.failed || this.desired === undefined) return
    const snapshot = this.desired
    this.desired = undefined
    const sequence = ++this.sequence
    this.tail = this.tail.then(async () => {
      try {
        await this.channel.updateCardById(this.cardId, snapshot, sequence)
      } catch (error) {
        this.failed = true
        this.onError(error)
      }
    })
  }
}
