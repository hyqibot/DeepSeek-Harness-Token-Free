/** Force a host-escalating shell call when HYQi is asked to open a local file. */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'

const LOCAL_OPEN_MEDIA_EXT =
  /\.(png|jpe?g|gif|webp|bmp|ico|pdf|mp4|avi|mkv|mov|docx?|xlsx?|pptx?)(\b|$)/i

export const LOCAL_OPEN_JUSTIFICATION =
  'Open a local image with the system default viewer; this needs host access outside the workspace sandbox.'

export const LOCAL_OPEN_DENIED_HINT =
  '未能打开该文件：当前是 Read only / Write，需要在聊天里批准提权后才会真正在本机打开。请在授权弹窗中允许，或把权限改为 Full access。不要把未批准或沙箱内的命令说成已经打开。'

export const LOCAL_OPEN_OK_HINT = '已在本机用系统默认程序打开该文件。'

export type HyqiChatToolCall = {
  readonly name: string
  readonly arguments: Record<string, unknown>
}

type OpenAiTool = {
  readonly type?: string
  readonly function?: {
    readonly name?: string
    readonly parameters?: {
      readonly properties?: Record<string, { readonly enum?: readonly string[] }>
      readonly required?: readonly string[]
    }
  }
}

type ChatMessage = {
  readonly role?: string
  readonly content?: unknown
  readonly isError?: boolean
  readonly tool_calls?: unknown
}

function flattenMessages(messages: readonly ChatMessage[]): string {
  return messages.map(row => messageText(row.content)).join('\n')
}

export function sessionDisablesSandboxEscalation(messages: readonly ChatMessage[]): boolean {
  return /Approval prompts are disabled|do not (?:request sandbox escalation|set [`']?sandbox_permissions[`']?)/i.test(
    flattenMessages(messages),
  )
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  if (content.some(part => part && typeof part === 'object' && (part as { type?: string }).type === 'tool_result')) {
    return ''
  }
  return content
    .filter(part => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string')
    .map(part => String((part as { text: string }).text))
    .join('\n\n')
}

function isHarnessInject(text: string): boolean {
  const value = text.trim()
  if (value.length === 0) return true
  if (value.startsWith('@deepseek-ai/')) return true
  if (/^skill-catalog\b/i.test(value)) return true
  if (value.includes('<system-reminder>') || value.includes('<available_skills>')) return true
  if (/Approval prompts are disabled|do not set [`']?sandbox_permissions[`']?/i.test(value)) return true
  return false
}

function lastTypedUserText(messages: readonly ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const row = messages[index]
    if (row?.role !== 'user') continue
    const text = messageText(row.content)
    if (isHarnessInject(text)) continue
    return text
  }
  return ''
}

function lastIsToolResult(messages: readonly ChatMessage[]): boolean {
  const last = messages.at(-1)
  return last?.role === 'tool' || last?.role === 'function'
}

export function isPlaceholderLocalOpenPath(filePath: string): boolean {
  const base = filePath.replace(/^.*[/\\]/, '').trim().toLowerCase()
  if (base.length === 0) return true
  return /^(filename|example|sample|your[_-]?file|xxx|test|image[_-]?name|name|placeholder)\.(png|jpe?g|gif|webp|bmp|ico|pdf|mp4|avi|mkv|mov|docx?|xlsx?|pptx?)$/i.test(base)
}

export function wantsOpenLocalMedia(text: string): boolean {
  const hasMedia = LOCAL_OPEN_MEDIA_EXT.test(text)
    || /(图片|截图|照片|图像|image|photo|screenshot|预览图)/i.test(text)
  if (!hasMedia) return false
  return /(打开|查看|预览|看看|看一下|open|view|show|display|launch)/i.test(text)
}

export function wantsDownloadRemote(text: string): boolean {
  return /https?:\/\/\S+/i.test(text) && /(?:下载|download|保存|抓取|curl|wget)/i.test(text)
}

export function guessLocalOpenPath(text: string): string {
  const win = text.match(/\b[A-Za-z]:\\[^\s"'<>|]+/)?.[0]
    ?? text.match(/%[A-Za-z_][A-Za-z0-9_]*%\\[^\s"'<>|]+/)?.[0]
    ?? ''
  if (win.length > 0 && LOCAL_OPEN_MEDIA_EXT.test(win) && !isPlaceholderLocalOpenPath(win)) return win
  const desk = text.match(
    /(?:桌面|Desktop)(?:上的|上|里的|中的|下的)?[/\\:\s]*([^\s"'`<>|]+\.(?:png|jpe?g|gif|webp|bmp|ico|pdf|mp4|avi|mkv|mov|docx?|xlsx?|pptx?))/i,
  )
  if (desk?.[1] && !isPlaceholderLocalOpenPath(desk[1])) {
    return `%USERPROFILE%\\Desktop\\${desk[1].replace(/^(?:上的|里的|中的|下的)/, '')}`
  }
  const bare = text.match(
    /(?:^|[^\w\u4e00-\u9fff])((?:[A-Za-z0-9_\u4e00-\u9fff][^\s"'`<>|]*)\.(?:png|jpe?g|gif|webp|bmp|ico|pdf|mp4|avi|mkv|mov|docx?|xlsx?|pptx?))(?:$|[^\w\u4e00-\u9fff])/i,
  )
  if (bare?.[1] && /(桌面|Desktop|打开|查看|open|view)/i.test(text) && !isPlaceholderLocalOpenPath(bare[1])) {
    return `%USERPROFILE%\\Desktop\\${bare[1].replace(/^桌面(?:上的|上|里的|中的|下的)?/, '')}`
  }
  return ''
}

function expandWinEnvPath(filePath: string): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? homedir()
  return filePath
    .replace(/%USERPROFILE%/gi, home)
    .replace(/%HOME%/gi, home)
}

export function resolveLocalOpenAbsPath(filePath: string): string {
  const raw = filePath.trim()
  if (raw.length === 0) return ''
  if (/^[A-Za-z]:[\\/]/.test(raw)) return normalize(raw)
  const home = process.env.USERPROFILE ?? process.env.HOME ?? homedir()
  const deskFile = raw.match(/^%USERPROFILE%\\Desktop\\(.+)$/i)
  if (deskFile?.[1]) {
    const name = deskFile[1].trim()
    const candidates = [
      join(home, 'Desktop', name),
      join(home, '桌面', name),
      join(home, 'OneDrive', 'Desktop', name),
      join(home, 'OneDrive', '桌面', name),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    return join(home, 'Desktop', name)
  }
  return normalize(expandWinEnvPath(raw))
}

export function startLocalFileCmd(filePath: string): string {
  const abs = resolveLocalOpenAbsPath(filePath) || expandWinEnvPath(filePath)
  const safe = abs.replace(/"/g, '').trim()
  if (safe.length === 0) return 'cmd.exe /c "echo missing file path& exit /b 1"'
  const psPath = safe.replace(/'/g, "''")
  return `powershell.exe -NoProfile -Command "Invoke-Item -LiteralPath '${psPath}'"`
}

function toolName(tool: OpenAiTool): string {
  return tool.function?.name?.trim() ?? ''
}

function pickShellName(tools: readonly OpenAiTool[]): string {
  const names = tools.map(toolName).filter(name => name.length > 0)
  const byCommand = tools.find(tool => {
    const props = tool.function?.parameters?.properties ?? {}
    return Object.keys(props).includes('command')
  })
  if (byCommand) return toolName(byCommand)
  return names.find(name => /^(Bash|bash|pwsh|execute_shell_command)$/i.test(name))
    ?? names.find(name => /bash|shell|pwsh|exec/i.test(name))
    ?? ''
}

function schemaProperties(tool: OpenAiTool | undefined): Record<string, { readonly enum?: readonly string[] }> {
  return tool?.function?.parameters?.properties ?? {}
}

export function localOpenEscalationArgs(
  shellName: string,
  tools: readonly OpenAiTool[],
  messages: readonly ChatMessage[] = [],
): Record<string, string> {
  if (sessionDisablesSandboxEscalation(messages)) return {}
  const tool = tools.find(row => toolName(row) === shellName)
  const props = schemaProperties(tool)
  if (!('sandbox_permissions' in props) || !('justification' in props)) return {}
  const enumModes = props.sandbox_permissions?.enum
  const mode = Array.isArray(enumModes) && enumModes.includes('danger-full-access')
    ? 'danger-full-access'
    : Array.isArray(enumModes) && enumModes.length > 0
      ? String(enumModes[enumModes.length - 1])
      : 'danger-full-access'
  return { sandbox_permissions: mode, justification: LOCAL_OPEN_JUSTIFICATION }
}

function asTools(value: unknown): OpenAiTool[] {
  return Array.isArray(value) ? value as OpenAiTool[] : []
}

function asMessages(value: unknown): ChatMessage[] {
  return Array.isArray(value) ? value as ChatMessage[] : []
}

function requiredArgs(
  shellName: string,
  tools: readonly OpenAiTool[],
  command: string,
  messages: readonly ChatMessage[],
): Record<string, unknown> {
  const tool = tools.find(row => toolName(row) === shellName)
  const required = tool?.function?.parameters?.required ?? []
  const args: Record<string, unknown> = {
    command,
    ...localOpenEscalationArgs(shellName, tools, messages),
  }
  if (required.includes('description') || 'description' in schemaProperties(tool)) {
    args.description = 'Open local file on the user\'s desktop'
  }
  return args
}

export function planHyqiLocalOpen(body: Record<string, unknown>): HyqiChatToolCall | null {
  const messages = asMessages(body.messages)
  if (lastIsToolResult(messages)) return null
  const tools = asTools(body.tools)
  const shellName = pickShellName(tools)
  if (shellName.length === 0) return null
  const userText = lastTypedUserText(messages)
  if (!wantsOpenLocalMedia(userText)) return null
  const openPath = guessLocalOpenPath(userText)
  if (openPath.length === 0 || isPlaceholderLocalOpenPath(openPath)) return null
  return {
    name: shellName,
    arguments: requiredArgs(shellName, tools, startLocalFileCmd(openPath), messages),
  }
}

function isLocalOpenShellCommand(command: string): boolean {
  return (
    (/Invoke-Item/i.test(command) && /(?:Desktop|桌面|[A-Za-z]:\\|%USERPROFILE%|\$env:USERPROFILE)/i.test(command))
    || (/Start-Process/i.test(command) && /(?:Desktop|桌面|[A-Za-z]:\\|%USERPROFILE%|\$env:USERPROFILE|GetFolderPath\(['"]Desktop['"]\))/i.test(command))
    || (/cmd\s+\/c\s+start/i.test(command) && /(?:Desktop|桌面|[A-Za-z]:\\|%USERPROFILE%|\$env:USERPROFILE)/i.test(command))
    || (/explorer\.exe/i.test(command) && /(?:Desktop|桌面|[A-Za-z]:|%USERPROFILE%|\$env:USERPROFILE)/i.test(command))
  )
}

function extractPathFromLocalOpenCommand(command: string): string {
  const invoke = command.match(/Invoke-Item(?:\s+-LiteralPath)?\s+['"]([^'"]+)['"]/i)?.[1]
  if (invoke && LOCAL_OPEN_MEDIA_EXT.test(invoke)) return invoke
  const start = command.match(/Start-Process(?:\s+-FilePath)?\s+['"]([^'"]+)['"]/i)?.[1]
    ?? command.match(/Start-Process\s+([^\s;]+)/i)?.[1]
  if (start && LOCAL_OPEN_MEDIA_EXT.test(start)) return start.replace(/^["']|["']$/g, '')
  const desktopFile = command.match(/(?:Desktop|桌面)[/\\]([^\s"'`;]+)/i)?.[1]
  if (desktopFile && LOCAL_OPEN_MEDIA_EXT.test(desktopFile)) return `%USERPROFILE%\\Desktop\\${desktopFile}`
  return ''
}

function localOpenNeedsEscalation(
  call: HyqiChatToolCall | null,
  messages: readonly ChatMessage[],
): boolean {
  if (call === null) return false
  if (sessionDisablesSandboxEscalation(messages)) return false
  return call.arguments.sandbox_permissions !== 'danger-full-access'
}

function toolResultLooksSuccessful(result: string): boolean {
  const trimmed = result.trim()
  if (trimmed.length === 0) return true
  if (/Exit code\s*0\b/i.test(trimmed)) return true
  return !/(?:Exit code\s*[1-9]\d*|error|失败|not found|找不到|FileNotFound|cannot find)/i.test(trimmed)
}

function isToolRole(row: ChatMessage | undefined): boolean {
  return row?.role === 'tool' || row?.role === 'function'
}

/**
 * The assistant whose tool_calls this trailing tool-result round belongs to.
 * Older local-open turns in the same chat must not claim later download/Read results.
 */
function lastAssistantBeforeTrailingTools(messages: readonly ChatMessage[]): ChatMessage | undefined {
  if (!lastIsToolResult(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const row = messages[index]
    if (isToolRole(row)) continue
    if (row?.role === 'assistant') return row
    return undefined
  }
  return undefined
}

function parseCallArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw as Record<string, unknown> }
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed as Record<string, unknown> } : {}
  } catch {
    return {}
  }
}

function localOpenCallFromAssistant(row: ChatMessage | undefined): HyqiChatToolCall | null {
  const calls = Array.isArray(row?.tool_calls) ? row.tool_calls : []
  for (const call of calls) {
    if (!call || typeof call !== 'object') continue
    const fn = (call as { function?: { name?: string; arguments?: unknown }; name?: string; arguments?: unknown })
    const name = String(fn.function?.name ?? fn.name ?? '')
    const args = parseCallArgs(fn.function?.arguments ?? fn.arguments)
    if (isLocalOpenShellCommand(String(args.command ?? ''))) {
      return { name, arguments: args }
    }
  }
  return null
}

function assistantOpenCommand(messages: readonly ChatMessage[]): string {
  return String(localOpenCallFromAssistant(lastAssistantBeforeTrailingTools(messages))?.arguments.command ?? '')
}

function lastLocalOpenCall(messages: readonly ChatMessage[]): HyqiChatToolCall | null {
  return localOpenCallFromAssistant(lastAssistantBeforeTrailingTools(messages))
}

function toolResultBlob(message: ChatMessage | undefined): string {
  const text = messageText(message?.content)
  if (text.length > 0) return text
  return message?.isError ? 'Error: tool call failed' : ''
}

export function planHyqiLocalOpenRetry(body: Record<string, unknown>): HyqiChatToolCall | null {
  const messages = asMessages(body.messages)
  if (!lastIsToolResult(messages)) return null
  const call = lastLocalOpenCall(messages)
  if (!call || typeof call.arguments.sandbox_permissions !== 'string') return null
  const result = toolResultBlob(messages.at(-1))
  const alreadyFull = sessionDisablesSandboxEscalation(messages)
  const notWider = /not strictly wider|sandbox_permissions is not available/i.test(result)
  if (!notWider && !alreadyFull) return null
  if (!notWider && alreadyFull && /Exit code\s*0\b/i.test(result)) return null
  const nextArgs = { ...call.arguments }
  delete nextArgs.sandbox_permissions
  delete nextArgs.justification
  return { name: call.name, arguments: nextArgs }
}

/**
 * After a sandboxed Start-Process / Invoke-Item exits 0 without host escalation,
 * rewrite the next turn into an escalated open so DSH shows the approval prompt.
 */
export function planLocalOpenEscalationRetry(body: Record<string, unknown>): HyqiChatToolCall | null {
  const messages = asMessages(body.messages)
  if (!lastIsToolResult(messages)) return null
  const call = lastLocalOpenCall(messages)
  if (!localOpenNeedsEscalation(call, messages)) return null
  const result = toolResultBlob(messages.at(-1))
  if (toolResultBlocked(result)) return null
  if (!toolResultLooksSuccessful(result)) return null
  const tools = asTools(body.tools)
  const escalation = localOpenEscalationArgs(call!.name, tools, messages)
  if (Object.keys(escalation).length === 0) return null
  const command = String(call!.arguments.command ?? '')
  const openPath = extractPathFromLocalOpenCommand(command)
    || guessLocalOpenPath(lastTypedUserText(messages))
  if (openPath.length === 0 || isPlaceholderLocalOpenPath(openPath)) return null
  return {
    name: call!.name,
    arguments: requiredArgs(call!.name, tools, startLocalFileCmd(openPath), messages),
  }
}

function toolResultBlocked(result: string): boolean {
  return /(?:\[sandbox:|file access denied|escalation available|sandbox_permissions|approval (?:rejected|denied|unavailable|cancelled)|user (?:denied|rejected)|permission denied|未批准|授权被拒)/i.test(result)
    && !/not strictly wider/i.test(result)
}

export function hyqiLocalOpenConfirmText(body: Record<string, unknown>): string | null {
  const messages = asMessages(body.messages)
  if (!lastIsToolResult(messages)) return null
  if (wantsDownloadRemote(lastTypedUserText(messages))) return null
  if (assistantOpenCommand(messages).length === 0) return null
  const result = messageText(messages.at(-1)?.content)
  if (toolResultBlocked(result)) return LOCAL_OPEN_DENIED_HINT
  const call = lastLocalOpenCall(messages)
  if (localOpenNeedsEscalation(call, messages) && toolResultLooksSuccessful(result)) {
    return LOCAL_OPEN_DENIED_HINT
  }
  const failed = /(?:Exit code\s*(?:[1-9]\d*)|error|失败|not found|找不到|FileNotFound|cannot find|not strictly wider)/i.test(result)
    && !/(?:Exit code\s*0\b)/i.test(result)
  if (failed) {
    return '已尝试用系统默认程序打开该桌面文件，但命令返回错误。请确认桌面上存在该文件名后重试。'
  }
  return LOCAL_OPEN_OK_HINT
}

function sseResponse(events: readonly Record<string, unknown>[]): Response {
  const body = `${events.map(event => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\ndata: [DONE]\n\n`
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
    },
  })
}

function chatId(): string {
  return `chatcmpl_hyqi_open_${Date.now().toString(36)}`
}

export function hyqiLocalOpenToolResponse(
  body: Record<string, unknown>,
  toolCall: HyqiChatToolCall,
): Response {
  const model = typeof body.model === 'string' ? body.model : 'HYQi-1.0-flash'
  const id = chatId()
  const created = Math.floor(Date.now() / 1000)
  const callId = `call_${Date.now().toString(36)}_0`
  const encoded = JSON.stringify(toolCall.arguments)
  if (body.stream === false) {
    return Response.json({
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: callId,
            type: 'function',
            function: { name: toolCall.name, arguments: encoded },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    })
  }
  return sseResponse([
    {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: callId,
            type: 'function',
            function: { name: toolCall.name, arguments: encoded },
          }],
        },
        finish_reason: null,
      }],
    },
    {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    },
  ])
}

export function hyqiLocalOpenTextResponse(body: Record<string, unknown>, text: string): Response {
  const model = typeof body.model === 'string' ? body.model : 'HYQi-1.0-flash'
  const id = chatId()
  const created = Math.floor(Date.now() / 1000)
  if (body.stream === false) {
    return Response.json({
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      }],
    })
  }
  return sseResponse([
    {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    },
    {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
  ])
}

/**
 * If this HYQi chat body is a local-open turn, return a synthetic completion
 * so DSH can show the Read only / Write approval prompt.
 */
export function interceptHyqiLocalOpenBody(body: Record<string, unknown>): Response | null {
  const escalationRetry = planLocalOpenEscalationRetry(body)
  if (escalationRetry !== null) return hyqiLocalOpenToolResponse(body, escalationRetry)
  const retry = planHyqiLocalOpenRetry(body)
  if (retry !== null) return hyqiLocalOpenToolResponse(body, retry)
  const confirm = hyqiLocalOpenConfirmText(body)
  if (confirm !== null) return hyqiLocalOpenTextResponse(body, confirm)
  const planned = planHyqiLocalOpen(body)
  if (planned === null) return null
  return hyqiLocalOpenToolResponse(body, planned)
}
