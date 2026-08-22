import { describe, expect, it } from 'vitest'
import {
  LOCAL_OPEN_DENIED_HINT,
  LOCAL_OPEN_JUSTIFICATION,
  guessLocalOpenPath,
  hyqiLocalOpenConfirmText,
  interceptHyqiLocalOpenBody,
  planHyqiLocalOpen,
  planLocalOpenEscalationRetry,
  wantsDownloadRemote,
  wantsOpenLocalMedia,
} from '../src/hyqi-local-open.ts'

const OPEN = '打开桌面上的11.png'

const dshPwsh = [
  {
    type: 'function',
    function: {
      name: 'pwsh',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          description: { type: 'string' },
          sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
          justification: { type: 'string' },
        },
        required: ['command', 'description'],
      },
    },
  },
]

const fullAccessBash = [
  {
    type: 'function',
    function: {
      name: 'bash',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['command', 'description'],
      },
    },
  },
]

describe('HYQi local-open escalation', () => {
  it('reads 打开桌面上的11.png as a desktop image path', () => {
    expect(wantsOpenLocalMedia(OPEN)).toBe(true)
    expect(guessLocalOpenPath(OPEN)).toBe('%USERPROFILE%\\Desktop\\11.png')
  })

  it('plans pwsh with danger-full-access when Read only / Write advertise escalation fields', () => {
    const planned = planHyqiLocalOpen({
      model: 'HYQi-1.0-flash',
      messages: [
        { role: 'user', content: OPEN },
        { role: 'user', content: '@deepseek-ai/dsh-system-prompt\nruntime' },
        { role: 'user', content: 'skill-catalog\nexample Desktop\\filename.png' },
      ],
      tools: dshPwsh,
    })
    expect(planned?.name).toBe('pwsh')
    expect(String(planned?.arguments.command ?? '')).toMatch(/11\.png/)
    expect(planned?.arguments.sandbox_permissions).toBe('danger-full-access')
    expect(planned?.arguments.justification).toBe(LOCAL_OPEN_JUSTIFICATION)
    expect(planned?.arguments.description).toMatch(/Open local file/)
  })

  it('omits sandbox_permissions when Full access hides the escalation fields', () => {
    const planned = planHyqiLocalOpen({
      model: 'HYQi-1.0-flash',
      messages: [{ role: 'user', content: OPEN }],
      tools: fullAccessBash,
    })
    expect(planned?.name).toBe('bash')
    expect(planned?.arguments.sandbox_permissions).toBeUndefined()
    expect(planned?.arguments.justification).toBeUndefined()
  })

  it('omits sandbox_permissions when Full access inject is present even if schema still lists it', () => {
    const planned = planHyqiLocalOpen({
      model: 'HYQi-1.0-flash',
      messages: [
        { role: 'user', content: OPEN },
        {
          role: 'user',
          content: 'Approval prompts are disabled in this session: do not set `sandbox_permissions`.',
        },
      ],
      tools: dshPwsh,
    })
    expect(planned?.name).toBe('pwsh')
    expect(planned?.arguments.sandbox_permissions).toBeUndefined()
    expect(planned?.arguments.justification).toBeUndefined()
  })

  it('retries a not-strictly-wider Full access failure without sandbox_permissions', async () => {
    const command = "powershell.exe -NoProfile -Command \"Invoke-Item -LiteralPath 'C:\\\\Users\\\\a\\\\Desktop\\\\11.png'\""
    const res = interceptHyqiLocalOpenBody({
      model: 'HYQi-1.0-flash',
      stream: true,
      tools: dshPwsh,
      messages: [
        { role: 'user', content: OPEN },
        {
          role: 'user',
          content: 'Approval prompts are disabled in this session: do not set `sandbox_permissions`.',
        },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'pwsh',
              arguments: JSON.stringify({
                command,
                description: 'Open local file on the user\'s desktop',
                sandbox_permissions: 'danger-full-access',
                justification: LOCAL_OPEN_JUSTIFICATION,
              }),
            },
          }],
        },
        {
          role: 'tool',
          content: 'Error: sandbox escalation to "danger-full-access" is not strictly wider than this call\'s current "danger-full-access" mode',
        },
      ],
    })
    expect(res).not.toBeNull()
    const text = await res!.text()
    expect(text).toContain('"finish_reason":"tool_calls"')
    expect(text).toContain('11.png')
    expect(text).not.toContain('danger-full-access')
    expect(text).not.toContain('已在本机用系统默认程序打开该文件')
  })

  it('does not plan for identity chitchat even if tools mention Desktop\\filename.png', () => {
    expect(planHyqiLocalOpen({
      model: 'HYQi-1.0-flash',
      messages: [
        { role: 'user', content: '你是谁' },
        { role: 'user', content: 'skill-catalog\nDesktop\\filename.png' },
      ],
      tools: dshPwsh,
    })).toBeNull()
  })

  it('returns a streaming tool_call so DSH can show the approval prompt', async () => {
    const res = interceptHyqiLocalOpenBody({
      model: 'HYQi-1.0-flash',
      stream: true,
      messages: [{ role: 'user', content: OPEN }],
      tools: dshPwsh,
    })
    expect(res).not.toBeNull()
    const text = await res!.text()
    expect(text).toContain('"finish_reason":"tool_calls"')
    expect(text).toContain('danger-full-access')
    expect(text).toContain('11.png')
    expect(text).toContain('data: [DONE]')
  })

  it('confirms a denied local-open tool result instead of letting the model pretend', () => {
    expect(hyqiLocalOpenConfirmText({
      messages: [
        { role: 'user', content: OPEN },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'pwsh',
              arguments: JSON.stringify({
                command: "powershell.exe -NoProfile -Command \"Invoke-Item -LiteralPath 'C:\\\\Users\\\\a\\\\Desktop\\\\11.png'\"",
              }),
            },
          }],
        },
        { role: 'tool', content: '[sandbox: escalation available] approval rejected' },
      ],
    })).toBe(LOCAL_OPEN_DENIED_HINT)
  })

  it('retries Start-Process sandbox fake success with danger-full-access escalation', () => {
    const body = {
      model: 'agnes-2.5-flash',
      stream: true,
      tools: dshPwsh,
      messages: [
        { role: 'user', content: OPEN },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'pwsh',
              arguments: JSON.stringify({
                command: 'Start-Process "$env:USERPROFILE\\Desktop\\11.png"',
                description: 'Open 11.png from desktop with default viewer',
              }),
            },
          }],
        },
        { role: 'tool', content: 'Exit code 0' },
      ],
    }
    expect(planLocalOpenEscalationRetry(body)?.arguments.sandbox_permissions).toBe('danger-full-access')
    expect(String(planLocalOpenEscalationRetry(body)?.arguments.command ?? '')).toMatch(/Invoke-Item/)
    expect(hyqiLocalOpenConfirmText(body)).toBe(LOCAL_OPEN_DENIED_HINT)
  })

  it('does not treat a later download/Read failure as the earlier desktop open', () => {
    const download = '下载 https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md 文档，下载完成后告诉我内容'
    expect(wantsDownloadRemote(download)).toBe(true)
    expect(hyqiLocalOpenConfirmText({
      messages: [
        { role: 'user', content: OPEN },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'call_open',
            type: 'function',
            function: {
              name: 'pwsh',
              arguments: JSON.stringify({
                command: "powershell.exe -NoProfile -Command \"Invoke-Item -LiteralPath 'C:\\\\Users\\\\a\\\\Desktop\\\\11.png'\"",
                description: 'Open local file on the user\'s desktop',
              }),
            },
          }],
        },
        { role: 'tool', content: 'Exit code 0' },
        { role: 'assistant', content: '已在本机用系统默认程序打开该文件。' },
        { role: 'user', content: download },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'call_dl',
            type: 'function',
            function: {
              name: 'pwsh',
              arguments: JSON.stringify({
                command: 'Invoke-WebRequest -Uri https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md -OutFile "$env:USERPROFILE\\Desktop\\A620260402NXEUQC.md"',
                description: 'Download remote Markdown to desktop',
              }),
            },
          }],
        },
        { role: 'tool', content: 'Error: cannot write C:\\Users\\hahay\\Desktop\\A620260402NXEUQC.md: not found' },
      ],
    })).toBeNull()
    expect(interceptHyqiLocalOpenBody({
      model: 'HYQi-1.0-flash',
      messages: [
        { role: 'user', content: OPEN },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'call_open',
            type: 'function',
            function: {
              name: 'pwsh',
              arguments: JSON.stringify({
                command: "powershell.exe -NoProfile -Command \"Invoke-Item -LiteralPath 'C:\\\\Users\\\\a\\\\Desktop\\\\11.png'\"",
              }),
            },
          }],
        },
        { role: 'user', content: download },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'call_read',
            type: 'function',
            function: {
              name: 'Read',
              arguments: JSON.stringify({ file_path: 'C:\\Users\\hahay\\Desktop\\A620260402NXEUQC.md' }),
            },
          }],
        },
        { role: 'tool', content: 'Error: cannot read "C:\\Users\\hahay\\Desktop\\A620260402NXEUQC.md": not found' },
      ],
    })).toBeNull()
  })
})
