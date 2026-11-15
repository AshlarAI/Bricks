// Display helpers for the conversation timeline. Pure functions only.
import { t, numberFormat } from '$lib/i18n/i18n.svelte'
import type { ChangeKind, Decision, DecidedBy, RunOutcome, Termination } from '$lib/ipc/engine'

const decimalFormat = numberFormat({ maximumFractionDigits: 1 })
const integerFormat = numberFormat()

const SHELL_TOOLS = new Set(['Bash', 'bash', 'Shell', 'PowerShell'])
// `Edit` may carry `edits` (several replacements in one call): its summary is still the path.
// `MultiEdit` and `NotebookEdit` are historical names of earlier calls: kept as
// recorded so old conversations still show their path, never offered as tools.
const PATH_TOOLS = new Set(['Read', 'ViewImage', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob'])

export const OUTCOME_LABEL: Record<RunOutcome, string> = {
  get succeeded() { return t('common.finished') },
  get incomplete() { return t('common.incomplete') },
  get failed() { return t('common.failed') },
  get cancelled() { return t('common.cancelled') },
}

export const DECISION_LABEL: Record<Decision, string> = {
  get allow() { return t('common.allowed') },
  get deny() { return t('common.refused2') },
}

export const DECIDED_BY_LABEL: Record<DecidedBy, string> = {
  get user() { return t('conversation.byYou') },
  get non_interactive() { return t('conversation.nonInteractiveMode') },
  get cancelled() { return t('conversation.cancelled') },
}

export const CHANGE_KIND_LABEL: Record<ChangeKind, string> = {
  get create() { return t('common.created') },
  get modify() { return t('common.modified') },
  get delete() { return t('common.deleted') },
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return '[valeur non affichable]'
  }
}

/** Pretty JSON for the detail views (never throws). */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return '[valeur non affichable]'
  }
}

const COMPUTER_USE_PREFIX = 'mcp__computer-use__'
const POINTER_ACTIONS = new Set([
  'click',
  'double_click',
  'right_click',
  'drag',
  'move_cursor',
  'scroll',
  'left_click',
  'mouse_click',
])
const TEXT_KEY_ACTIONS = new Set(['type_text', 'set_value', 'press_key', 'hotkey'])
const WINDOW_APP_ACTIONS = new Set([
  'get_window_state',
  'get_desktop_state',
  'get_accessibility_tree',
  'launch_app',
  'bring_to_front',
  'list_windows',
  'list_apps',
  'set_window_frame',
  'invoke_menu',
  'zoom',
  'verify_state',
  'kill_app',
])
const SENSITIVE_FIELD = /password|passcode|pin|secret|token|mot de passe/i

/** Human-readable tool name for MCP tools (`mcp__<server>__<tool>`), unchanged otherwise. */
export function formatToolName(name: string): string {
  if (!name.startsWith('mcp__')) return name
  const rest = name.slice(5)
  const sep = rest.indexOf('__')
  if (sep <= 0) return name
  const server = rest.slice(0, sep)
  const tool = rest.slice(sep + 2)
  if (!tool) return name
  return server === 'computer-use' ? `Computer Use · ${tool}` : `${server} · ${tool}`
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

function stepActionName(step: Record<string, unknown>): string | null {
  if (typeof step.tool === 'string' && step.tool.length > 0) return step.tool
  for (const [key, val] of Object.entries(step)) {
    if (key !== 'wait_for' && key !== 'expect' && isRecord(val)) return key
  }
  return null
}

function stepArgs(step: Record<string, unknown>, action: string | null): Record<string, unknown> | null {
  if (isRecord(step.args)) return step.args
  if (action && isRecord(step[action])) return step[action]
  return null
}

function formatElementTarget(obj: Record<string, unknown>): string | null {
  const role = firstString(obj, ['role'])
  const label = firstString(obj, ['name', 'title', 'label'])
  const token = firstString(obj, ['element_token'])
  if (role && label) return `${role} "${truncate(oneLine(label), 32)}"`
  if (label) return `"${truncate(oneLine(label), 32)}"`
  if (role) return role
  if (token) return truncate(token, 20)
  return null
}

function formatCoords(obj: Record<string, unknown>): string | null {
  if (
    typeof obj.from_x === 'number' &&
    typeof obj.from_y === 'number' &&
    typeof obj.to_x === 'number' &&
    typeof obj.to_y === 'number'
  ) {
    return `(${obj.from_x}, ${obj.from_y}) → (${obj.to_x}, ${obj.to_y})`
  }
  if (typeof obj.x === 'number' && typeof obj.y === 'number') {
    return `(${obj.x}, ${obj.y})`
  }
  return null
}

function formatAppWindow(obj: Record<string, unknown>): string | null {
  const app = firstString(obj, ['app', 'bundle_id'])
  const win = firstString(obj, ['window'])
  const parts = [app, win].filter((v): v is string => Boolean(v)).map((v) => truncate(oneLine(v), 40))
  return parts.length > 0 ? parts.join(' — ') : null
}

function formatMaskedText(obj: Record<string, unknown>, raw: string): string {
  const elLabel = firstString(obj, ['name', 'title', 'label', 'ref', 'selector', 'target']) ?? ''
  return obj.password === true || SENSITIVE_FIELD.test(elLabel)
    ? '••••'
    : `"${truncate(oneLine(raw), 40)}"`
}

function summarizeComputerUseInput(action: string, input: Record<string, unknown>): string | null {
  if (action === 'run_steps' && Array.isArray(input.steps)) {
    const actions: string[] = []
    let firstTarget: string | null = formatAppWindow(input)
    for (const step of input.steps) {
      if (!isRecord(step)) continue
      const act = stepActionName(step)
      if (act) actions.push(act)
      if (!firstTarget) {
        const args = stepArgs(step, act)
        if (args) firstTarget = formatAppWindow(args)
      }
    }
    const countLabel = t('conversation.stepCount', { count: input.steps.length })
    const preview = actions.slice(0, 4).join(' → ') + (actions.length > 4 ? ' → …' : '')
    const parts = [firstTarget, countLabel, preview].filter(Boolean)
    return parts.length > 0 ? truncate(parts.join(' · '), 160) : null
  }

  const target = formatAppWindow(input)
  const element = formatElementTarget(input)

  if (POINTER_ACTIONS.has(action)) {
    const coords = formatCoords(input)
    const parts = [target, element ?? coords].filter(Boolean)
    return parts.length > 0 ? truncate(parts.join(' · '), 160) : null
  }

  if (TEXT_KEY_ACTIONS.has(action)) {
    let payload: string | null = null
    if (action === 'hotkey') {
      if (Array.isArray(input.keys)) {
        const keys = input.keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
        if (keys.length > 0) payload = keys.join('+')
      } else {
        payload = firstString(input, ['keys', 'hotkey'])
      }
    } else if (action === 'press_key') {
      payload = firstString(input, ['key'])
    } else {
      const raw = firstString(input, ['text', 'value'])
      if (raw !== null) payload = formatMaskedText(input, raw)
    }
    const parts = [target, element, payload].filter(Boolean)
    return parts.length > 0 ? truncate(parts.join(' · '), 160) : null
  }

  if (WINDOW_APP_ACTIONS.has(action)) {
    const query = firstString(input, ['query'])
    const rawMenu = Array.isArray(input.path)
      ? input.path
      : Array.isArray(input.menu_path)
        ? input.menu_path
        : null
    const menuPath = rawMenu
      ? rawMenu.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' › ')
      : null
    const pid = !target && typeof input.pid === 'number' ? `pid ${input.pid}` : null
    const parts = [target, menuPath, query, pid].filter(Boolean)
    return parts.length > 0 ? truncate(parts.join(' · '), 160) : null
  }

  if (action.startsWith('browser_') || action === 'page') {
    const url = firstString(input, ['url'])
    const text = firstString(input, ['text'])
    const refOrSel = firstString(input, ['ref', 'selector', 'query'])
    const parts = [
      url ? truncate(oneLine(url), 60) : null,
      text ? formatMaskedText(input, text) : null,
      refOrSel ? truncate(oneLine(refOrSel), 40) : null,
    ].filter(Boolean)
    return parts.length > 0 ? truncate(parts.join(' · '), 160) : null
  }

  return null
}

/** One-line summary of a tool input: the command, the path, or the first keys. */
export function summarizeInput(name: string, input: unknown): string {
  if (input === undefined || input === null) return ''
  if (typeof input === 'string') return truncate(oneLine(input), 160)
  if (!isRecord(input)) return truncate(oneLine(safeJson(input)), 160)
  if (SHELL_TOOLS.has(name) && typeof input.command === 'string') {
    return truncate(oneLine(input.command), 160)
  }
  if (PATH_TOOLS.has(name)) {
    const path = firstString(input, ['file_path', 'path', 'notebook_path'])
    if (path) return truncate(path, 160)
  }
  if (SEARCH_TOOLS.has(name) && typeof input.pattern === 'string') {
    const path = firstString(input, ['path'])
    return truncate(oneLine(input.pattern) + (path ? t('conversation.in', { path }) : ''), 160)
  }
  if (name.startsWith(COMPUTER_USE_PREFIX)) {
    const cuSummary = summarizeComputerUseInput(name.slice(COMPUTER_USE_PREFIX.length), input)
    if (cuSummary !== null) return cuSummary
  }
  const parts = Object.entries(input)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? oneLine(value) : safeJson(value)}`)
  return truncate(parts.join(' · '), 160)
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return [hours && `${hours}h`, minutes && `${minutes}m`, (seconds || total === 0) && `${seconds}s`]
    .filter(Boolean).join(' ')
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = [t('conversation.byte'), t('conversation.kb'), t('conversation.mb'), t('conversation.gb')]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 ? integerFormat : decimalFormat
  return `${digits.format(value)} ${units[unit]}`
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** What an attachment is, in one word: « Dossier », or the file's extension (« PDF »). */
export function attachmentKind(kind: string, name: string): string {
  if (kind === 'folder') return t('common.folder')
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : ''
}

function numberField(value: Termination, key: string): number | null {
  const v = (value as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : null
}

/** Human reason for a run that did not complete normally, or null. */
export function terminationLabel(termination: Termination | undefined): string | null {
  if (!termination) return null
  switch (termination.kind) {
    case 'completed':
      return null
    case 'output_truncated': {
      const n = numberField(termination, 'continuations')
      return n === null ? t('conversation.outputTruncated') : t('conversation.outputTruncatedAfterContinuation', { count: n })
    }
    case 'no_progress': {
      const n = numberField(termination, 'repeats')
      return n === null ? t('conversation.noProgressDetected') : t('conversation.noProgressDetectedRepetitions', { n })
    }
    default:
      // A kind of an earlier version: interrupted, never a success.
      return t('common.interruptedEndOldSession')
  }
}

export interface TestCounts {
  framework: string
  passed: number
  failed: number
}

function count(text: string, word: string): number | null {
  const m = text.match(new RegExp(`(\\d+) ${word}\\b`))
  return m ? Number(m[1]) : null
}

/**
 * Reads pass/fail totals from a test runner's own report. Returns null when
 * the output is not a recognised report, so no count is shown.
 */
export function parseTestCounts(output: string): TestCounts | null {
  const cargo = [...output.matchAll(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed/g)]
  if (cargo.length > 0) {
    return {
      framework: 'cargo test',
      passed: cargo.reduce((sum, m) => sum + Number(m[1]), 0),
      failed: cargo.reduce((sum, m) => sum + Number(m[2]), 0),
    }
  }
  const pytest = output.match(/^=+ (.*\b(?:passed|failed|errors?)\b.*) in [\d.]+s.*=+\s*$/m)
  if (pytest) {
    const passed = count(pytest[1], 'passed')
    const failed = count(pytest[1], 'failed')
    if (passed !== null || failed !== null) {
      return { framework: 'pytest', passed: passed ?? 0, failed: failed ?? 0 }
    }
  }
  const vitest = output.match(/^\s*Tests\s+(.+?)\s*$/m)
  if (vitest) {
    const passed = count(vitest[1], 'passed')
    const failed = count(vitest[1], 'failed')
    if (passed !== null || failed !== null) {
      return { framework: 'vitest', passed: passed ?? 0, failed: failed ?? 0 }
    }
  }
  const mocha = output.match(/^\s*(\d+) passing\b/m)
  if (mocha) {
    const failing = output.match(/^\s*(\d+) failing\b/m)
    return { framework: 'mocha', passed: Number(mocha[1]), failed: failing ? Number(failing[1]) : 0 }
  }
  return null
}

