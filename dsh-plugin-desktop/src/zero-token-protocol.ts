/** Convert Anthropic Messages bodies to and from upstream chat APIs. */

/** One Anthropic message block used by the local gateway. */
export interface AnthropicMessage {
  readonly role: 'user' | 'assistant' | 'system'
  readonly content: string | readonly Record<string, unknown>[]
}

/** Incoming `/v1/messages` JSON body. */
export interface AnthropicMessagesRequest {
  readonly model?: string
  readonly messages?: readonly AnthropicMessage[]
  readonly system?: string | readonly Record<string, unknown>[]
  readonly max_tokens?: number
  readonly stream?: boolean
}

/**
 * Flatten Anthropic content into plain text for upstream chat APIs.
 * @param content - string or content-block list.
 */
export function flattenAnthropicContent(content: AnthropicMessage['content'] | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => String(block.text))
    .join('')
}

/**
 * Build a single user-visible prompt from an Anthropic Messages request.
 * @param body - parsed request.
 */
export function anthropicRequestPrompt(body: AnthropicMessagesRequest): string {
  const parts: string[] = []
  const system = flattenAnthropicContent(body.system)
  if (system.length > 0) parts.push(system)
  for (const message of body.messages ?? []) {
    const text = flattenAnthropicContent(message.content)
    if (text.length === 0) continue
    parts.push(`${message.role}: ${text}`)
  }
  return parts.join('\n\n')
}

/**
 * Build a non-streaming Anthropic Messages response.
 * @param id - response id.
 * @param model - advertised model id.
 * @param text - assistant text.
 */
export function anthropicMessagesResponse(id: string, model: string, text: string): Record<string, unknown> {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}

/**
 * Parse a JSON body into an Anthropic Messages request.
 * @param value - parsed JSON.
 */
export function parseAnthropicMessagesRequest(value: unknown): AnthropicMessagesRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('zero-token gateway expects a JSON object body')
  }
  return value as AnthropicMessagesRequest
}

/**
 * Map Anthropic messages onto an OpenAI-style chat completion body.
 * @param body - Anthropic request.
 * @param model - upstream model id.
 */
export function toChatCompletionsBody(body: AnthropicMessagesRequest, model: string): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = []
  const system = flattenAnthropicContent(body.system)
  if (system.length > 0) messages.push({ role: 'system', content: system })
  for (const message of body.messages ?? []) {
    messages.push({
      role: message.role === 'system' ? 'system' : message.role,
      content: flattenAnthropicContent(message.content),
    })
  }
  return {
    model,
    messages,
    max_tokens: body.max_tokens ?? 4096,
    stream: false,
  }
}

/**
 * Read assistant text from an OpenAI-style chat completion payload.
 * @param value - parsed JSON.
 */
export function chatCompletionText(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('upstream chat completion was not an object')
  }
  const choices = (value as Record<string, unknown>).choices
  if (!Array.isArray(choices) || choices[0] === undefined) {
    throw new Error('upstream chat completion omitted choices')
  }
  const first = choices[0]
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    throw new Error('upstream chat completion choice was not an object')
  }
  const message = (first as Record<string, unknown>).message
  if (message !== null && typeof message === 'object' && !Array.isArray(message)) {
    const content = (message as Record<string, unknown>).content
    if (typeof content === 'string') return content
  }
  const text = (first as Record<string, unknown>).text
  if (typeof text === 'string') return text
  throw new Error('upstream chat completion omitted text')
}

/**
 * Read assistant text from an Anthropic Messages payload.
 * @param value - parsed JSON.
 */
export function anthropicResponseText(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('upstream Anthropic response was not an object')
  }
  const content = (value as Record<string, unknown>).content
  if (!Array.isArray(content)) {
    throw new Error('upstream Anthropic response omitted content')
  }
  return content
    .filter(block => block !== null && typeof block === 'object' && (block as Record<string, unknown>).type === 'text')
    .map(block => String((block as Record<string, unknown>).text ?? ''))
    .join('')
}
