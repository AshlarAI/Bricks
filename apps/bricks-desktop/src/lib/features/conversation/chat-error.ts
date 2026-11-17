// The error shown above the composer (ChatErrorBanner.svelte): the last failed run of the
// conversation, or a command the engine refused. Engine messages are English and technical;
// the known ones get a translated sentence and keep their text as the details.
import { t } from '$lib/i18n/i18n.svelte'

export interface ChatErrorView {
  /** One line, in the interface language. */
  message: string
  /** The engine's text, when the message does not already say it all. */
  detail: string | null
  /** No API key: the only way out is the model settings (no copy, details or retry). */
  modelConfigMissing: boolean
  /** A hook stopped the run. */
  hookBlocked: boolean
}

// The quotes are written \u0022 so that no scanner reads a string literal in the pattern.
const NO_API_KEY = /Authentication error: provider \u0022([^\u0022]+)\u0022: no API key/
const AUTHENTICATION = /^Authentication error:/
const PROVIDER_STATUS = /^Provider error (\d{3})(?::\s*([\s\S]*))?$/
const RATE_LIMIT = /^Rate limit exceeded/
const CONTEXT_OVERFLOW = /^Context overflow:/
const HOOK_BLOCKED = /Blocked by hook: ([\s\S]*)$/

/**
 * The view of an engine error. `prefix` names a refused command (« Changement de modèle
 * refusé »); it leads the message.
 */
export function resolveChatError(raw: string, prefix?: string | null): ChatErrorView {
  const text = raw.trim()
  const lead = (message: string) => (prefix ? t('chat.error.prefixed', { prefix, message }) : message)

  const noKey = NO_API_KEY.exec(text)
  if (noKey) {
    return { message: lead(t('chat.error.noApiKey', { provider: noKey[1] })), detail: null, modelConfigMissing: true, hookBlocked: false }
  }
  const hook = HOOK_BLOCKED.exec(text)
  if (hook) {
    // One line: a multi-line reason stays whole in the details.
    const reason = hook[1].trim().replace(/\s+/g, ' ')
    return { message: lead(t('chat.error.hookBlocked', { reason })), detail: text, modelConfigMissing: false, hookBlocked: true }
  }
  if (AUTHENTICATION.test(text)) {
    return { message: lead(t('chat.error.authentication')), detail: text, modelConfigMissing: false, hookBlocked: false }
  }
  const status = PROVIDER_STATUS.exec(text)
  if (status) {
    return { message: lead(t('chat.error.providerStatus', { status: status[1] })), detail: text, modelConfigMissing: false, hookBlocked: false }
  }
  if (RATE_LIMIT.test(text)) {
    return { message: lead(t('chat.error.rateLimited')), detail: text, modelConfigMissing: false, hookBlocked: false }
  }
  if (CONTEXT_OVERFLOW.test(text)) {
    return { message: lead(t('chat.error.contextOverflow')), detail: text, modelConfigMissing: false, hookBlocked: false }
  }
  // Unknown: the first line is the message; the whole text is the details when there is more.
  const firstLine = text.split('\n', 1)[0] || t('chat.error.unknown')
  return {
    message: lead(firstLine),
    detail: text.includes('\n') ? text : null,
    modelConfigMissing: false,
    hookBlocked: false,
  }
}

/** The text « Copier » puts in the clipboard: a heading, the summary, then the details. */
export function chatErrorCopyText(view: ChatErrorView): string {
  return [
    t('chat.error.copyHeading'),
    '',
    t('chat.error.summary'),
    view.message,
    view.detail ? ['', t('chat.error.detailHeading'), view.detail].join('\n') : null,
  ]
    .filter((line): line is string => line != null)
    .join('\n')
}
