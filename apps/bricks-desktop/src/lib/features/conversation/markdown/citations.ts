// Citations of the links in a reply: what the hover card of a link shows. A link to a page that a
// web search of the conversation returned gets that result's title and summary; any other link
// shows its own text and its site. Pure (no runes, no IPC): unit-tested.

/** A web page as a search returned it. */
export interface CitationSource {
  title: string
  snippet: string
  url: string
}

/** One result line of the `WebSearch` tool: `[S1] Title — https://…`. */
const RESULT = /^\[S\d+\] (.+) — (https?:\/\/\S+)\s*$/
/** Its summary follows on lines indented by five spaces. */
const SNIPPET = /^ {5}(\S.*)$/

/** The address a link and a result share: no fragment, no trailing slash. */
export function citationKey(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

/** The results of the `WebSearch` outputs of a conversation, by address; the first one wins. */
export function webSearchSources(outputs: readonly string[]): Map<string, CitationSource> {
  const sources = new Map<string, CitationSource>()
  for (const output of outputs) {
    let last: CitationSource | null = null
    for (const line of output.split(/\r?\n/)) {
      const result = RESULT.exec(line)
      if (result) {
        last = { title: result[1].trim(), url: result[2], snippet: '' }
        const key = citationKey(last.url)
        if (!sources.has(key)) sources.set(key, last)
        continue
      }
      const snippet = last ? SNIPPET.exec(line) : null
      if (last && snippet) {
        last.snippet = last.snippet ? `${last.snippet} ${snippet[1].trim()}` : snippet[1].trim()
      } else {
        last = null
      }
    }
  }
  return sources
}

/** The site of an address, without `www.`; the address itself when it is not one. */
export function citationHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Only web pages get a card (not `mailto:` or a file). */
export function isCitable(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
