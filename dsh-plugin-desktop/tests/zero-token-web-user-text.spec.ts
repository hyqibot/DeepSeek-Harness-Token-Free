import { describe, expect, it } from 'vitest'
// @ts-expect-error vendored CoPaw gateway ESM has no types
import * as toolBridge from '../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/tool-bridge.mjs'
// @ts-expect-error vendored CoPaw gateway ESM has no types
import * as xmlToolPrompt from '../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/xml-tool-prompt.mjs'
// @ts-expect-error vendored CoPaw gateway ESM has no types
import * as toolPlanner from '../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/tool-schema-planner.mjs'
// @ts-expect-error vendored CoPaw gateway ESM has no types
import * as deepseekPrompt from '../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-prompt.mjs'

const {
  mapToolCallsToAvailableTools,
  anthropicFirstTypedUserAnchor,
  anthropicLastUserText,
  isCasualUserTurn,
  isHarnessInjectUserText,
  isModelIdentityUserTurn,
  looksLikeToolRefusal,
  shouldResetDoubaoWebConversation,
  orderDoubaoComposerUserBodies,
  doubaoComposerUserChunksFromMessages,
  packDoubaoWebPromptParts,
  formatDoubaoWebOtherChunks,
  buildDoubaoSamanthaMessages,
  validateDirectDownloadToolSequence,
  downloadToolResultLooksFailed,
  guardRepeatDownloadTools,
} = toolBridge
const { buildDoubaoLocalDesktopHint } = xmlToolPrompt
const {
  planLocalOpenToolCalls,
  planLocalOpenRetryWithoutEscalation,
  planDownloadToolCalls,
  planDownloadRetryWithoutEscalation,
  localOpenToolResultConfirmReply,
  localOpenToolResultConfirmText,
  tryPlannerFallbackForParsedUpstream,
  sessionDisablesSandboxEscalation,
} = toolPlanner
const { buildDeepSeekDoubaoAlignedPromptForTurn, shouldUseXmlToolCompactPrompt } = deepseekPrompt

const NEVER_SNAPSHOT = [
  'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.',
  '',
  'Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).',
].join('\n')

const SKILL_CATALOG = [
  '<system-reminder>',
  '<available_skills>',
  '<skill name="example">demo</skill>',
  '</available_skills>',
  'If a skill matches the task, call the skill tool.',
  '</system-reminder>',
].join('\n')

const DSH_SYSTEM_PROMPT = '@deepseek-ai/dsh-system-prompt\nCurrent runtime context. This snapshot supersedes earlier runtime-context snapshots.'
const DSH_SKILL_CATALOG = 'skill-catalog\npermission preset danger-full-access'
const TYPED = '你好，你是什么模型'
const WHO = '你是谁'
const WHO_HELLO = '你好，你是谁'
const OPEN = '打开桌面上的11.png'
const DOWNLOAD = '下载 https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md 文档，下载完成后告诉我内容'
const DOWNLOAD_URL = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'

const bash = [
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'shell',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
  },
]

describe('Doubao composer users (native/ChatGPT analog)', () => {
  it('treats DSH inject labels as injects, not identity questions', () => {
    expect(isHarnessInjectUserText(NEVER_SNAPSHOT)).toBe(true)
    expect(isHarnessInjectUserText(SKILL_CATALOG)).toBe(true)
    expect(isHarnessInjectUserText(DSH_SYSTEM_PROMPT)).toBe(true)
    expect(isHarnessInjectUserText(DSH_SKILL_CATALOG)).toBe(true)
    expect(isHarnessInjectUserText(TYPED)).toBe(false)
    expect(isHarnessInjectUserText(WHO)).toBe(false)
    expect(isHarnessInjectUserText(OPEN)).toBe(false)
  })

  it('picks the typed user turn over DSH inject user messages', () => {
    expect(
      anthropicLastUserText([
        { role: 'user', content: TYPED },
        { role: 'user', content: NEVER_SNAPSHOT },
        { role: 'user', content: SKILL_CATALOG },
      ]),
    ).toBe(TYPED)
    expect(
      anthropicLastUserText([
        { role: 'user', content: WHO },
        { role: 'user', content: DSH_SYSTEM_PROMPT },
        { role: 'user', content: DSH_SKILL_CATALOG },
      ]),
    ).toBe(WHO)
    expect(
      anthropicLastUserText([
        { role: 'user', content: OPEN },
        { role: 'user', content: DSH_SYSTEM_PROMPT },
        { role: 'user', content: DSH_SKILL_CATALOG },
      ]),
    ).toBe(OPEN)
  })

  it('does not send skill-catalog as last user; typed question wins', () => {
    expect(
      anthropicLastUserText([
        { role: 'user', content: TYPED },
        { role: 'user', content: DSH_SYSTEM_PROMPT },
        { role: 'user', content: SKILL_CATALOG },
      ]),
    ).toBe(TYPED)
  })

  it('does not treat 你是什么模型 as a special casual/identity turn', () => {
    expect(isCasualUserTurn(TYPED)).toBe(false)
    expect(isCasualUserTurn(WHO)).toBe(true)
    expect(isCasualUserTurn(WHO_HELLO)).toBe(true)
    expect(isCasualUserTurn(OPEN)).toBe(false)
  })

  it('keeps cc-haha Doubao local-desktop hint without identity-skill examples', () => {
    const hint = buildDoubaoLocalDesktopHint([
      { type: 'function', function: { name: 'Bash', description: 'shell' } },
    ])
    expect(hint).toContain('NOT in a remote sandbox')
    expect(hint).not.toContain('询问模型身份')
    expect(hint).not.toContain('identity questions')
  })

  it('plans Bash from the typed open request even when a harness inject is last', () => {
    const messages = [
      { role: 'user', content: OPEN },
      { role: 'user', content: DSH_SYSTEM_PROMPT },
      { role: 'user', content: DSH_SKILL_CATALOG },
    ]
    const planned = planLocalOpenToolCalls(anthropicLastUserText(messages), bash)
    expect(planned.ok).toBe(true)
    expect(planned.toolCalls[0]?.name).toBe('Bash')
    expect(String(planned.toolCalls[0]?.arguments?.command || '')).toMatch(/11\.png/)
  })

  it('plans DSH lowercase bash when description is required', () => {
    const dshBash = [
      {
        type: 'function',
        function: {
          name: 'bash',
          description: 'shell',
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
    const planned = planLocalOpenToolCalls(OPEN, dshBash)
    expect(planned.ok).toBe(true)
    expect(planned.toolCalls[0]?.name).toBe('bash')
    expect(String(planned.toolCalls[0]?.arguments?.command || '')).toMatch(/11\.png/)
    expect(String(planned.toolCalls[0]?.arguments?.description || '')).toMatch(/Open local file/)
  })

  it('omits sandbox_permissions when Full access already disables escalation', () => {
    const dshPwsh = [
      {
        type: 'function',
        function: {
          name: 'pwsh',
          description: 'shell',
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
    const messages = [
      { role: 'user', content: OPEN },
      { role: 'user', content: NEVER_SNAPSHOT },
      { role: 'user', content: DSH_SKILL_CATALOG },
    ]
    expect(sessionDisablesSandboxEscalation(messages)).toBe(true)
    const planned = planLocalOpenToolCalls(OPEN, dshPwsh, { messages })
    expect(planned.ok).toBe(true)
    expect(planned.toolCalls[0]?.name).toBe('pwsh')
    expect(planned.toolCalls[0]?.arguments?.sandbox_permissions).toBeUndefined()
    expect(planned.toolCalls[0]?.arguments?.justification).toBeUndefined()
    expect(String(planned.toolCalls[0]?.arguments?.command || '')).toMatch(/11\.png/)
  })

  it('keeps danger-full-access for Read only / Write when Full access inject is absent', () => {
    const dshPwsh = [
      {
        type: 'function',
        function: {
          name: 'pwsh',
          description: 'shell',
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
    const planned = planLocalOpenToolCalls(OPEN, dshPwsh, {
      messages: [{ role: 'user', content: OPEN }],
    })
    expect(planned.toolCalls[0]?.arguments?.sandbox_permissions).toBe('danger-full-access')
  })

  it('retries a Full access not-strictly-wider failure without sandbox_permissions', () => {
    const dshPwsh = [
      {
        type: 'function',
        function: {
          name: 'pwsh',
          description: 'shell',
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
    const command = "powershell.exe -NoProfile -Command \"Invoke-Item -LiteralPath 'C:\\\\Users\\\\a\\\\Desktop\\\\11.png'\""
    const retry = planLocalOpenRetryWithoutEscalation(
      [
        { role: 'user', content: OPEN },
        { role: 'user', content: NEVER_SNAPSHOT },
        {
          role: 'assistant',
          tool_calls: [{
            function: {
              name: 'pwsh',
              arguments: JSON.stringify({
                command,
                description: 'Open local file on the user\'s desktop',
                sandbox_permissions: 'danger-full-access',
                justification: 'open',
              }),
            },
          }],
        },
        {
          role: 'tool',
          content: 'Error: sandbox escalation to "danger-full-access" is not strictly wider than this call\'s current "danger-full-access" mode',
        },
      ],
      dshPwsh,
    )
    expect(retry.ok).toBe(true)
    expect(retry.toolCalls[0]?.name).toBe('pwsh')
    expect(retry.toolCalls[0]?.arguments?.command).toBe(command)
    expect(retry.toolCalls[0]?.arguments?.sandbox_permissions).toBeUndefined()
    expect(retry.toolCalls[0]?.arguments?.justification).toBeUndefined()
  })

  it('does not confirm a not-strictly-wider tool result as opened', () => {
    const reply = localOpenToolResultConfirmReply(
      'Error: sandbox escalation to "danger-full-access" is not strictly wider than this call\'s current "danger-full-access" mode',
    )
    expect(reply).not.toContain('已在本机用系统默认程序打开该文件')
    expect(reply).toMatch(/错误|未能打开/)
  })

  it('treats 没办法直接访问本地文件 as a tool refusal', () => {
    expect(looksLikeToolRefusal('我没办法直接访问、读取你电脑本地的文件，包括桌面的 11.png。')).toBe(true)
  })

  it('keeps DSH injects on system and the typed question as the only user turn', () => {
    const identityMessages = [
      { role: 'user', content: WHO_HELLO },
      { role: 'user', content: DSH_SYSTEM_PROMPT },
      { role: 'user', content: DSH_SKILL_CATALOG },
    ]
    const chunks = doubaoComposerUserChunksFromMessages(identityMessages)
    expect(chunks.at(-1)).toBe(WHO_HELLO)
    expect(chunks.some((c: string) => /@deepseek-ai\/dsh-system-prompt|runtime context/i.test(c))).toBe(true)
    expect(chunks.some((c: string) => /^skill-catalog\b/i.test(c))).toBe(true)

    const packed = packDoubaoWebPromptParts(identityMessages)
    expect(packed.typedUser).toBe(WHO_HELLO)
    expect(packed.contextChunks.some((c: string) => /@deepseek-ai\/dsh-system-prompt|runtime context/i.test(c))).toBe(true)
    expect(packed.contextChunks.some((c: string) => /^skill-catalog\b/i.test(c))).toBe(true)

    const samantha = buildDoubaoSamanthaMessages(identityMessages, {
      toolPrompt: '<tools></tools>',
    })
    expect(samantha).toHaveLength(1)
    expect(samantha[0]?.role).toBe('user')
    expect(String(samantha[0]?.content)).toContain('System:')
    expect(String(samantha[0]?.content)).toContain('skill-catalog')
    expect(String(samantha[0]?.content)).toContain('@deepseek-ai/dsh-system-prompt')
    expect(String(samantha[0]?.content)).toContain('<tools>')
    expect(String(samantha[0]?.content)).toMatch(new RegExp(`User: ${WHO_HELLO}$`))

    const other = formatDoubaoWebOtherChunks(identityMessages)
    const userLines = other.filter((c: string) => /^User: /.test(c))
    expect(userLines).toEqual([])
    expect(other).toEqual([WHO_HELLO])
    expect(other.some((c: string) => /^User: skill-catalog/i.test(c))).toBe(false)
    expect(other.some((c: string) => /^User: @deepseek-ai\//i.test(c))).toBe(false)
    expect(other.join('\n')).not.toContain('skill-catalog')

    const ordered = orderDoubaoComposerUserBodies([WHO_HELLO, DSH_SYSTEM_PROMPT, DSH_SKILL_CATALOG])
    expect(ordered.at(-1)).toBe(WHO_HELLO)
    expect(ordered[0]).not.toBe(WHO_HELLO)

    const openChunks = doubaoComposerUserChunksFromMessages([
      { role: 'user', content: OPEN },
      { role: 'user', content: DSH_SYSTEM_PROMPT },
      { role: 'user', content: DSH_SKILL_CATALOG },
    ])
    expect(openChunks.at(-1)).toBe(OPEN)
    expect(openChunks.some((c: string) => /^skill-catalog\b/i.test(c))).toBe(true)
    expect(formatDoubaoWebOtherChunks([
      { role: 'user', content: OPEN },
      { role: 'user', content: DSH_SYSTEM_PROMPT },
      { role: 'user', content: DSH_SKILL_CATALOG },
    ]).at(-1)).toBe(OPEN)
    expect(shouldUseXmlToolCompactPrompt(WHO_HELLO)).toBe(true)
    expect(shouldUseXmlToolCompactPrompt(OPEN)).toBe(false)
  })

  it('resets Doubao conversation on a fresh DSH turn or identity question, not on tool results', () => {
    expect(isModelIdentityUserTurn(TYPED)).toBe(true)
    expect(isModelIdentityUserTurn(WHO)).toBe(true)
    expect(isModelIdentityUserTurn(WHO_HELLO)).toBe(true)
    expect(isModelIdentityUserTurn(OPEN)).toBe(false)
    expect(isCasualUserTurn(TYPED)).toBe(false)
    expect(
      shouldResetDoubaoWebConversation([
        { role: 'user', content: TYPED },
        { role: 'user', content: DSH_SYSTEM_PROMPT },
        { role: 'user', content: DSH_SKILL_CATALOG },
      ]),
    ).toBe(true)
    expect(
      shouldResetDoubaoWebConversation([
        { role: 'user', content: OPEN },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: WHO_HELLO },
      ]),
    ).toBe(true)
    expect(
      shouldResetDoubaoWebConversation([
        { role: 'user', content: OPEN },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: TYPED },
      ]),
    ).toBe(true)
    expect(
      shouldResetDoubaoWebConversation([
        { role: 'user', content: OPEN },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Bash', arguments: '{}' } }] },
        { role: 'tool', content: 'opened', tool_call_id: 'c1' },
      ]),
    ).toBe(false)
  })

  it('anchors DeepSeek conv on the first typed user, skipping DSH injects', () => {
    const injectFirst = [
      { role: 'user', content: DSH_SYSTEM_PROMPT },
      { role: 'user', content: DSH_SKILL_CATALOG },
      { role: 'user', content: TYPED },
    ]
    const laterTurn = [
      { role: 'user', content: TYPED },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: DSH_SYSTEM_PROMPT },
      { role: 'user', content: '下一句' },
    ]
    const a = anthropicFirstTypedUserAnchor(injectFirst)
    const b = anthropicFirstTypedUserAnchor(laterTurn)
    expect(a).toMatch(/^txt:/)
    expect(a).toBe(b)
    expect(a).not.toBe(anthropicFirstTypedUserAnchor([{ role: 'user', content: OPEN }]))
  })

  it('uses compact XML for identity/chat and full Tool Use Instructions for open-file', () => {
    expect(shouldUseXmlToolCompactPrompt(TYPED)).toBe(true)
    expect(shouldUseXmlToolCompactPrompt(WHO)).toBe(true)
    expect(shouldUseXmlToolCompactPrompt(OPEN)).toBe(false)
    expect(shouldUseXmlToolCompactPrompt(TYPED, { requireTool: true })).toBe(false)

    const identity = buildDeepSeekDoubaoAlignedPromptForTurn(
      [
        { role: 'user', content: TYPED },
        { role: 'user', content: DSH_SYSTEM_PROMPT },
        { role: 'user', content: DSH_SKILL_CATALOG },
      ],
      bash,
      null,
    )
    expect(identity).not.toContain('## Tool Use Instructions')
    expect(identity).toContain('[TOOL REMINDER]')
    expect(identity).toContain(TYPED)

    const open = buildDeepSeekDoubaoAlignedPromptForTurn(
      [
        { role: 'user', content: OPEN },
        { role: 'user', content: DSH_SYSTEM_PROMPT },
        { role: 'user', content: DSH_SKILL_CATALOG },
      ],
      bash,
      null,
    )
    expect(open).toContain('## Tool Use Instructions')
    expect(open).toContain(OPEN)

    const toolLoop = buildDeepSeekDoubaoAlignedPromptForTurn(
      [
        { role: 'user', content: OPEN },
        { role: 'tool', content: 'opened', tool_call_id: 'c1', name: 'Bash' },
      ],
      bash,
      'parent-1',
    )
    expect(toolLoop).toContain('<tool_response')
    expect(toolLoop).toContain('[TOOL REMINDER]')
    expect(toolLoop).not.toContain('## Tool Use Instructions')
  })
})

describe('Zero-Token download planner and local-open confirm scope', () => {
  const invokeItem = "powershell.exe -NoProfile -Command \"Invoke-Item -LiteralPath 'C:\\\\Users\\\\a\\\\Desktop\\\\11.png'\""

  it('synthesizes a single curl print with HTTP fallback instead of Doubao XML', () => {
    const planned = planDownloadToolCalls(DOWNLOAD, bash)
    expect(planned.ok).toBe(true)
    expect(planned.toolCalls).toHaveLength(1)
    expect(planned.toolCalls[0]?.name).toBe('Bash')
    const command = String(planned.toolCalls[0]?.arguments?.command || '')
    expect(command).toContain(DOWNLOAD_URL)
    expect(command).toContain('http://marketing.dfcfw.com/res/download/A620260402NXEUQC.md')
    expect(command).toContain('curl.exe')
    expect(command).toContain('-sL')
    expect(command).not.toContain('Invoke-Item')
    expect(command).not.toContain('Invoke-WebRequest')
  })

  it('plans native pwsh curl without nested powershell.exe', () => {
    const dshPwsh = [
      {
        type: 'function',
        function: {
          name: 'pwsh',
          description: 'shell',
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
    const planned = planDownloadToolCalls(DOWNLOAD, dshPwsh, {
      messages: [{ role: 'user', content: DOWNLOAD }],
    })
    expect(planned.ok).toBe(true)
    expect(planned.toolCalls[0]?.name).toBe('pwsh')
    const command = String(planned.toolCalls[0]?.arguments?.command || '')
    expect(command).toContain('curl.exe -sL --fail')
    expect(command).not.toMatch(/powershell\.exe/i)
    expect(planned.toolCalls[0]?.arguments?.sandbox_permissions).toBe('danger-full-access')
  })

  it('omits download sandbox escalation when Full access already disables it', () => {
    const dshPwsh = [
      {
        type: 'function',
        function: {
          name: 'pwsh',
          description: 'shell',
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
    const messages = [
      { role: 'user', content: DOWNLOAD },
      { role: 'user', content: NEVER_SNAPSHOT },
      { role: 'user', content: DSH_SKILL_CATALOG },
    ]
    const planned = planDownloadToolCalls(DOWNLOAD, dshPwsh, { messages })
    expect(planned.ok).toBe(true)
    expect(planned.toolCalls[0]?.arguments?.sandbox_permissions).toBeUndefined()
  })

  it('accepts stdout curl print for direct download validation (Doubao/DeepSeek shared)', () => {
    const planned = planDownloadToolCalls(DOWNLOAD, [{
      type: 'function',
      function: {
        name: 'pwsh',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' }, description: { type: 'string' } },
          required: ['command', 'description'],
        },
      },
    }])
    expect(validateDirectDownloadToolSequence(planned.toolCalls ?? [], DOWNLOAD, [{
      type: 'function',
      function: {
        name: 'pwsh',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' }, description: { type: 'string' } },
          required: ['command', 'description'],
        },
      },
    }])).toBe(true)
  })

  it('treats empty pwsh curl download output as failed for repeat guard', () => {
    expect(downloadToolResultLooksFailed('', 'pwsh')).toBe(true)
    const guard = guardRepeatDownloadTools(
      [{
        name: 'pwsh',
        arguments: {
          command: `curl.exe -sL --fail -- '${DOWNLOAD_URL}'`,
          description: 'Download remote document and print its contents',
        },
      }],
      [
        { role: 'user', content: DOWNLOAD },
        {
          role: 'assistant',
          tool_calls: [{
            function: {
              name: 'pwsh',
              arguments: JSON.stringify({
                command: `curl.exe -sL --fail -- '${DOWNLOAD_URL}'`,
                description: 'Download remote document and print its contents',
              }),
            },
          }],
        },
        { role: 'tool', content: '' },
      ],
    )
    expect(guard.suppressed).toBe(true)
    expect(guard.reason).toBe('failed')
  })

  it('retries download without sandbox_permissions after not-strictly-wider failure', () => {
    const dshPwsh = [{
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
    }]
    const command = `curl.exe -sL --fail -- '${DOWNLOAD_URL}'`
    const retry = planDownloadRetryWithoutEscalation([
      { role: 'user', content: DOWNLOAD },
      { role: 'user', content: NEVER_SNAPSHOT },
      {
        role: 'assistant',
        tool_calls: [{
          function: {
            name: 'pwsh',
            arguments: JSON.stringify({
              command,
              description: 'Download remote document and print its contents',
              sandbox_permissions: 'danger-full-access',
              justification: 'network',
            }),
          },
        }],
      },
      {
        role: 'tool',
        content: 'Error: sandbox escalation to "danger-full-access" is not strictly wider than this call\'s current "danger-full-access" mode',
      },
    ], dshPwsh)
    expect(retry.ok).toBe(true)
    expect(retry.toolCalls[0]?.arguments?.sandbox_permissions).toBeUndefined()
    expect(String(retry.toolCalls[0]?.arguments?.command || '')).toContain(DOWNLOAD_URL)
  })

  it('does not plan a download for identity chat', () => {
    expect(planDownloadToolCalls(WHO_HELLO, bash).ok).toBe(false)
    expect(planDownloadToolCalls(OPEN, bash).ok).toBe(false)
  })

  it('replaces a truncated Doubao Bash URL with the planned download', () => {
    const parsed = tryPlannerFallbackForParsedUpstream(
      {
        ok: true,
        toolCalls: [{
          name: 'Bash',
          arguments: { command: "Invoke-WebRequest -Uri 'https0260402NXEUQC.md'" },
        }],
      },
      bash,
      DOWNLOAD,
    )
    expect(parsed.plannerApplied).toBe(true)
    expect(String(parsed.toolCalls[0]?.arguments?.command || '')).toContain(DOWNLOAD_URL)
  })

  it('confirms only the trailing local-open tool result', () => {
    expect(localOpenToolResultConfirmText([
      { role: 'user', content: OPEN },
      {
        role: 'assistant',
        tool_calls: [{ function: { name: 'pwsh', arguments: JSON.stringify({ command: invokeItem }) } }],
      },
      { role: 'tool', content: 'Exit code 0' },
    ], { userText: OPEN })).toBe('已在本机用系统默认程序打开该文件。')
  })

  it('does not confirm a later download failure as the earlier desktop open', () => {
    const text = localOpenToolResultConfirmText([
      { role: 'user', content: OPEN },
      {
        role: 'assistant',
        tool_calls: [{ function: { name: 'pwsh', arguments: JSON.stringify({ command: invokeItem }) } }],
      },
      { role: 'tool', content: 'Exit code 0' },
      { role: 'assistant', content: '已在本机用系统默认程序打开该文件。' },
      { role: 'user', content: DOWNLOAD },
      {
        role: 'assistant',
        tool_calls: [{
          function: {
            name: 'pwsh',
            arguments: JSON.stringify({
              command: `Invoke-WebRequest -Uri ${DOWNLOAD_URL} -OutFile "$env:USERPROFILE\\Desktop\\A620260402NXEUQC.md"`,
            }),
          },
        }],
      },
      { role: 'tool', content: 'Error: cannot write desktop file' },
    ], { userText: DOWNLOAD })
    expect(text).toBe('')
    expect(text).not.toContain('已在本机用系统默认程序打开该文件')
  })
})

describe('mapToolCallsToAvailableTools', () => {
  it('maps exec to Bash when Bash is in Available Tools', () => {
    const mapped = mapToolCallsToAvailableTools(
      [{ name: 'exec', arguments: { command: 'echo hi' } }],
      bash,
    )
    expect(mapped).toHaveLength(1)
    expect(mapped[0]?.name).toBe('Bash')
    expect(mapped[0]?.arguments).toEqual({ command: 'echo hi' })
  })
})
