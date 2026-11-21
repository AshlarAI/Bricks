import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { hintIndex } from './hints'
import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview'
import { Button } from '$lib/components/ui/button'
import { Textarea } from '$lib/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip'
import { app, useApp } from '$lib/state/app'
import { ui, useUi } from '$lib/state/ui'
import {
  useConversation,
  type Conversation,
  type Draft,
  type DraftAttachment,
  type UserItem,
} from '$lib/state/conversation'
import ChatErrorBanner from '$lib/features/conversation/ChatErrorBanner'
import { resolveChatError, type ChatErrorView } from '$lib/features/conversation/chat-error'
import { runEndSummary } from '$lib/features/conversation/runend'
import {
  appQuit,
  attachmentImportBytes,
  attachmentImportPath,
  attachmentPreview,
  discardDraftAttachment,
  discardSessionAttachment,
  errorMessage,
  pathKind,
  promoteDraft,
  sessionAttachmentPaths,
  slashParse,
} from '$lib/ipc/client'
import type { SlashCommandInfo } from '$lib/ipc/bindings/SlashCommandInfo'
import type { ImportedAttachment } from '$lib/ipc/bindings/ImportedAttachment'
import type { PromptBlock } from '$lib/ipc/engine'
import { ArrowUpIcon, SparklesIcon, SquareIcon, XIcon } from 'lucide-react'
import AttachMenu from './AttachMenu'
import AttachmentChip from './AttachmentChip'
import ModelSelect from './ModelSelect'
import ContextGauge from '$lib/features/context/ContextGauge'
import CommandPalette from '$lib/features/commands/CommandPalette'
import QuitDialog from '$lib/features/commands/QuitDialog'
import MentionPalette from './MentionPalette'
import SkillPicker from './SkillPicker'
import { selectionAfterRun, toggleSkill } from './skills'
import { MentionFiles, useMentionFiles } from './mention-files'
import { mentionAt, projectEntryPath, removeMention, type MentionToken } from './mentions'
import type { ProjectFileEntry } from '$lib/ipc/bindings/ProjectFileEntry'
import { slashRegistry, useSlashRegistry } from '$lib/features/commands/slash-registry'
import {
  completeLine,
  filterCommands,
  isExactName,
  moveIndex,
  paletteQuery,
} from '$lib/features/commands/palette'
import {
  HistoryCursor,
  shouldRecallNewer,
  shouldRecallOlder,
} from '$lib/features/commands/history'
import {
  runSlashLine,
  type AttachKind,
  type SlashHost,
  type SlashOutcome,
} from '$lib/features/commands/dispatch'
import { basename, blobToBase64, extensionFor, isImagePath } from './attachments'
import { cn } from '$lib/utils'

// Browsers without CSS field-sizing get the manual height fallback below.
const HAS_FIELD_SIZING = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content')

// Engine refusals of the commands this composer sends, shown near the editor.
const REJECTION_LABELS: Record<string, string> = {
  get submit() {
    return t('composer.sendingRefused')
  },
  get set_model() {
    return t('composer.modelChangeRefused')
  },
  get set_reasoning() {
    return t('composer.effortChangeRefused')
  },
  get compact() {
    return t('composer.compactionRefused')
  },
}

type DraftOwner =
  | { kind: 'conversation'; conv: Conversation }
  | { kind: 'project'; projectId: string }
  | { kind: 'local' }

function ownerKey(owner: DraftOwner): string {
  switch (owner.kind) {
    case 'conversation':
      return `conv:${owner.conv.sessionId}`
    case 'project':
      return `proj:${owner.projectId}`
    case 'local':
      return 'local'
  }
}

function revoke(a: DraftAttachment) {
  if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
}

/** A folder is sent by reference (its listing is read at send). */
function toBlock(a: DraftAttachment): PromptBlock {
  switch (a.kind) {
    case 'image':
      return { kind: 'image', path: a.path }
    case 'folder':
      return { kind: 'folder', path: a.path }
    default:
      return { kind: 'file', path: a.path }
  }
}

function updateDraftFor(
  owner: DraftOwner,
  setLocalDraft: Dispatch<SetStateAction<Draft>>,
  updater: (curr: Draft) => Partial<Draft> | null,
) {
  switch (owner.kind) {
    case 'conversation': {
      const patch = updater(owner.conv.draft)
      if (patch) owner.conv.setDraft(patch)
      return
    }
    case 'project': {
      const patch = updater(app.draftFor(owner.projectId))
      if (patch) app.setProjectDraft(owner.projectId, patch)
      return
    }
    case 'local': {
      setLocalDraft((curr) => {
        const patch = updater(curr)
        return patch ? { ...curr, ...patch } : curr
      })
    }
  }
}

export interface ComposerProps {
  conversation: Conversation | null
}

export function Composer({ conversation }: ComposerProps) {
  useLanguage()
  useApp()
  useConversation(conversation)
  const uiStore = useUi()
  const registryState = useSlashRegistry()

  const NO_IMAGE_MESSAGE = t('composer.thisModelDoesntAcceptImagesRemove')
  const uid = useId()
  const paletteId = `${uid}-palette`
  const mentionId = `${uid}-mention`

  const project = app.currentProject

  // ─── Draft ────────────────────────────────────────────────────────────────
  // An open conversation keeps its own draft (it survives switches). Without
  // one, the project's draft (kept by the app state, one per project) is used
  // until the first valid send creates the conversation.
  const [localDraft, setLocalDraft] = useState<Draft>({ text: '', attachments: [], skills: [] })
  const localDraftRef = useRef(localDraft)
  localDraftRef.current = localDraft

  const owner: DraftOwner = conversation
    ? { kind: 'conversation', conv: conversation }
    : project
      ? { kind: 'project', projectId: project.id }
      : { kind: 'local' }

  const draft: Draft = conversation
    ? conversation.draft
    : project
      ? app.draftFor(project.id)
      : localDraft

  const draftTextRef = useRef(draft.text)
  draftTextRef.current = draft.text

  function readDraft(targetOwner: DraftOwner): Draft {
    switch (targetOwner.kind) {
      case 'conversation':
        return targetOwner.conv.draft
      case 'project':
        return app.draftFor(targetOwner.projectId)
      case 'local':
        return localDraftRef.current
    }
  }

  function updateDraft(targetOwner: DraftOwner, updater: (curr: Draft) => Partial<Draft> | null) {
    updateDraftFor(targetOwner, setLocalDraft, updater)
  }

  // ─── Model and effort ─────────────────────────────────────────────────────
  // Without a conversation, these choices are used by the first send.
  const [pickedModel, setPickedModel] = useState<string | null>(null)
  const [pickedEffort, setPickedEffort] = useState<string | null>(null)
  // Set by `/model`, `/effort` (through `ui.picker`) to open the selects.
  const [modelOpen, setModelOpen] = useState(false)
  /** The skills choice of the `+` menu. */
  const [skillsOpen, setSkillsOpen] = useState(false)

  const hasModels = app.models.length > 0
  const selection: string | null = conversation
    ? conversation.model
    : project
      ? app.draftModel(project.id)
      : (pickedModel ?? app.models[0]?.selection ?? null)
  const choice = app.model(selection)
  const draftEffort: string | null = project ? app.draftReasoning(project.id) : pickedEffort
  const effortValue: string | null = conversation ? conversation.reasoning : draftEffort
  const effortEffective: string | null = conversation
    ? conversation.effectiveReasoning
    : (draftEffort ?? choice?.default_profile ?? null)
  const supportsImage = choice?.input.includes('image') ?? false

  // ─── State flags ──────────────────────────────────────────────────────────
  const editable = project !== null && !project.missing && hasModels
  const running = conversation?.running ?? false

  const [saving, setSaving] = useState(0)
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingCaretRef = useRef<number | null>(null)

  /** Why an attachment cannot be sent, or `null` when it can. */
  function chipError(a: DraftAttachment): string | null {
    if (a.error) return a.error
    if (a.importing) return null
    if (a.kind === 'image' && !supportsImage) return NO_IMAGE_MESSAGE
    return null
  }

  const blocked = draft.attachments.some((a) => chipError(a) !== null)
  const importing = draft.attachments.some((a) => a.importing)
  const hasContent = draft.text.trim() !== '' || draft.attachments.length > 0
  const canSend = editable && !running && !sending && saving === 0 && !importing && !blocked && hasContent
  /** A `/` line is run by the composer, never sent as a prompt (leading spaces do not count). */
  const isSlashLine = draft.text.trimStart().startsWith('/')
  const slashReady = isSlashLine && editable && !sending && saving === 0

  const placeholder = (() => {
    if (!project) return t('composer.createAProjectToWrite')
    if (project.missing) return t('composer.theProjectFolderCantBeFound')
    if (!hasModels) return t('composer.noModelConfigured')
    const hints = [t('composer.anythingToSay'), t('composer.eagerForYourMind'), t('composer.askBricksAnything')]
    return hints[hintIndex(conversation?.sessionId ?? '', hints.length)]
  })()

  // ─── Attachments ──────────────────────────────────────────────────────────

  // Imports of one draft run one after the other: the first one creates the
  // draft's folder, the next ones reuse it.
  const importChainsRef = useRef(new Map<string, Promise<void>>())

  /**
   * Copies a file or pasted bytes into the draft (the app checks the type and size
   * and owns the copy: the original can move or change afterwards). The chip shows
   * the import; a refusal stays on its chip and the rest of the draft is kept.
   */
  function importInto(
    targetOwner: DraftOwner,
    name: string,
    kind: DraftAttachment['kind'],
    run: (draftId: string | null) => Promise<ImportedAttachment>,
    previewUrl?: string,
  ) {
    const id = crypto.randomUUID()
    updateDraft(targetOwner, (curr) => ({
      attachments: [...curr.attachments, { id, kind, path: '', name, previewUrl, importing: true }],
    }))
    setSaving((n) => n + 1)
    const key = ownerKey(targetOwner)
    const previous = importChainsRef.current.get(key) ?? Promise.resolve()
    const next = previous.then(async () => {
      try {
        const currentDraftId = readDraft(targetOwner).draftId ?? null
        const imported = await run(currentDraftId)
        let kept = true
        updateDraft(targetOwner, (curr) => {
          const chip = curr.attachments.find((a) => a.id === id)
          if (!chip) {
            kept = false
            return null
          }
          const updated: DraftAttachment = {
            ...chip,
            attachmentId: imported.attachment.id,
            name: imported.attachment.name,
            kind: imported.attachment.kind === 'image' ? 'image' : 'file',
            importing: false,
          }
          return {
            draftId: curr.draftId ?? imported.draft_id,
            attachments: curr.attachments.map((a) => (a.id === id ? updated : a)),
          }
        })
        if (!kept) {
          // Removed while it was being copied: its copy goes too.
          void discardDraftAttachment(imported.draft_id, imported.attachment.id).catch(() => {})
          return
        }
        if (imported.attachment.kind === 'image' && !previewUrl) {
          void attachmentPreview('draft', imported.draft_id, imported.attachment.id)
            .then((p) => {
              if (!p.data_url) return
              updateDraft(targetOwner, (curr) => {
                if (!curr.attachments.some((a) => a.id === id)) return null
                return {
                  attachments: curr.attachments.map((a) =>
                    a.id === id ? { ...a, previewUrl: p.data_url ?? undefined } : a,
                  ),
                }
              })
            })
            .catch(() => {})
        }
      } catch (e) {
        updateDraft(targetOwner, (curr) => {
          if (!curr.attachments.some((a) => a.id === id)) return null
          return {
            attachments: curr.attachments.map((a) =>
              a.id === id ? { ...a, importing: false, error: errorMessage(e) } : a,
            ),
          }
        })
      } finally {
        setSaving((n) => n - 1)
      }
    })
    importChainsRef.current.set(key, next)
  }

  /** A path chosen, dropped or named: a folder is a reference, anything else a copy. */
  function addPath(targetOwner: DraftOwner, path: string, found: 'file' | 'folder') {
    if (found === 'folder') {
      updateDraft(targetOwner, (curr) => {
        if (curr.attachments.some((a) => a.kind === 'folder' && a.path === path)) return null
        return {
          attachments: [...curr.attachments, { id: crypto.randomUUID(), kind: 'folder', path, name: basename(path) }],
        }
      })
      return
    }
    importInto(targetOwner, basename(path), isImagePath(path) ? 'image' : 'file', (draftId) =>
      attachmentImportPath(draftId, path),
    )
  }

  /** Items picked in the native dialog: the kind is known from the menu entry. */
  function addPicked(paths: string[], folder: boolean) {
    if (!editable || sending) return
    const targetOwner = owner
    for (const path of paths) addPath(targetOwner, path, folder ? 'folder' : 'file')
  }

  /** Dropped items: folders and missing paths are told apart by `pathKind`. */
  async function addDropped(paths: string[]) {
    if (!editable || sending) return
    const targetOwner = owner
    for (const path of paths) {
      let found: 'file' | 'folder' | 'missing'
      try {
        found = await pathKind(path)
      } catch (e) {
        updateDraft(targetOwner, (curr) => ({
          attachments: [
            ...curr.attachments,
            { id: crypto.randomUUID(), kind: 'file', path, name: basename(path), error: errorMessage(e) },
          ],
        }))
        continue
      }
      if (found === 'missing') {
        updateDraft(targetOwner, (curr) => ({
          attachments: [
            ...curr.attachments,
            { id: crypto.randomUUID(), kind: 'file', path, name: basename(path), error: t('composer.itemNotFound') },
          ],
        }))
        continue
      }
      addPath(targetOwner, path, found)
    }
  }

  /** Attaches a path named by `/file`, `/folder` or `/image` (the path is checked first). */
  async function attachByPath(kind: AttachKind, path: string): Promise<string | null> {
    if (!editable) return t('composer.openAProjectAndConfigureA')
    let found: 'file' | 'folder' | 'missing'
    try {
      found = await pathKind(path)
    } catch (e) {
      return errorMessage(e)
    }
    if (found === 'missing') return t('composer.itemNotFound2', { path })
    if (kind === 'folder' && found !== 'folder') return t('composer.isntAFolder', { path })
    if (kind !== 'folder' && found === 'folder') return t('composer.isAFolderUseFolder', { path })
    if (kind === 'image' && !isImagePath(path)) {
      return t('composer.isntAnImagePngJpegGif', { path })
    }
    addPath(owner, path, found)
    return null
  }

  /** A pasted image: copied into the draft. */
  async function addImage(blob: Blob, name: string) {
    const targetOwner = owner
    const preview = URL.createObjectURL(blob)
    try {
      const data = await blobToBase64(blob)
      importInto(targetOwner, name, 'image', (draftId) => attachmentImportBytes(draftId, name, data), preview)
    } catch (e) {
      URL.revokeObjectURL(preview)
      setRefusal(errorMessage(e))
    }
  }

  function removeAttachment(id: string) {
    const targetOwner = owner
    const current = readDraft(targetOwner)
    const gone = current.attachments.find((a) => a.id === id)
    if (!gone) return
    revoke(gone)
    updateDraft(targetOwner, (curr) => ({
      attachments: curr.attachments.filter((a) => a.id !== id),
    }))
    // Its copy is freed (a copy a sent message refers to is kept by the app).
    if (gone.attachmentId && gone.sessionId) {
      void discardSessionAttachment(gone.sessionId, gone.attachmentId).catch(() => {})
    } else if (gone.attachmentId && current.draftId) {
      void discardDraftAttachment(current.draftId, gone.attachmentId).catch(() => {})
    }
  }

  /**
   * The prompt blocks of the attachments, once their copies belong to the
   * conversation: the draft's copies move into it, then are sent by their path
   * there. Folders stay references.
   */
  async function attachmentBlocksFor(
    source: Draft,
    sessionId: string,
  ): Promise<{ blocks: PromptBlock[]; promotedIds: Set<string> }> {
    const copies = source.attachments.filter((a) => a.attachmentId)
    const promotedIds = new Set<string>()
    if (copies.length > 0 && source.draftId && copies.some((a) => a.sessionId !== sessionId)) {
      await promoteDraft(source.draftId, sessionId)
      for (const a of copies) promotedIds.add(a.id)
    }
    const paths = new Map<string, string>()
    if (copies.length > 0) {
      for (const r of await sessionAttachmentPaths(
        sessionId,
        copies.map((a) => a.attachmentId as string),
      )) {
        paths.set(r.id, r.path)
      }
    }
    const blocks: PromptBlock[] = []
    for (const a of source.attachments) {
      if (!a.attachmentId) {
        blocks.push(toBlock(a))
        continue
      }
      const path = paths.get(a.attachmentId)
      if (!path) throw new Error(t('composer.theCopyOfCantBeFound', { name: a.name }))
      blocks.push({ kind: a.kind === 'image' ? 'image' : 'file', path })
    }
    return { blocks, promotedIds }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!editable || sending) return
    const items = Array.from(e.clipboardData?.items ?? [])
    // Plain text keeps the default paste behaviour.
    if (items.some((i) => i.kind === 'string' && i.type === 'text/plain')) return
    const image = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'))
    const file = image?.getAsFile()
    if (!file) return
    e.preventDefault()
    const name = file.name || `image-${Date.now()}.${extensionFor(file.type)}`
    void addImage(file, name)
  }

  /**
   * True when a dropped point is over the composer. The native event gives physical
   * pixels on some platforms and logical points on others (macOS): the point is
   * accepted in either unit, so a Retina or a second screen does not move the target.
   */
  function insideComposer(x: number, y: number): boolean {
    const el = rootRef.current
    if (!el) return false
    const r = el.getBoundingClientRect()
    const scale = window.devicePixelRatio || 1
    const within = (px: number, py: number) => px >= r.left && px <= r.right && py >= r.top && py <= r.bottom
    return within(x, y) || within(x / scale, y / scale)
  }

  function onDragDrop(event: DragDropEvent) {
    if (event.type === 'leave') {
      setDragging(false)
      return
    }
    const inside = insideComposer(event.position.x, event.position.y)
    if (event.type === 'drop') {
      setDragging(false)
      if (inside) void addDropped(event.paths)
      return
    }
    setDragging(inside && editable)
  }

  const onDragDropRef = useRef(onDragDrop)
  onDragDropRef.current = onDragDrop

  const [files] = useState(() => new MentionFiles())
  const filesState = useMentionFiles(files)

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    try {
      void getCurrentWebview()
        .onDragDropEvent((event) => onDragDropRef.current(event.payload))
        .then((fn) => {
          if (disposed) fn()
          else unlisten = fn
        })
        .catch(() => {})
    } catch {
      // Not running inside Tauri: there is no native drop target.
    }
    void slashRegistry.load()
    return () => {
      disposed = true
      unlisten?.()
      files.dispose()
    }
  }, [files])

  // ─── Model and effort choices ─────────────────────────────────────────────

  /** Model choice without an open conversation: kept for the first send. */
  function applyLocalModel(next: string, reasoning: string | null): string | null {
    const target = app.model(next)
    if (!target) return t('composer.unknownModel', { next })
    const known = (profile: string | null) =>
      profile !== null && target.profiles.some((p) => p.id === profile)
    if (reasoning !== null && !known(reasoning)) {
      return t('composer.unknownEffortProfileFor', { name: target.name, reasoning })
    }
    const resolvedEffort = reasoning ?? (known(draftEffort) ? draftEffort : null)
    setPickedModel(next)
    setPickedEffort(resolvedEffort)
    if (project) app.setDraftModel(project.id, next, resolvedEffort)
    return null
  }

  /** Effort choice without an open conversation: kept for the first send. */
  function applyLocalEffort(profile: string | null): string | null {
    if (profile !== null && !(choice?.profiles.some((p) => p.id === profile) ?? false)) {
      return t('composer.unknownEffortProfile', { profile })
    }
    setPickedEffort(profile)
    if (project && selection) app.setDraftModel(project.id, selection, profile)
    return null
  }

  /** A model and its level picked together; the level alone when the model stays. */
  async function pickModel(next: string, level: string | null): Promise<string | null> {
    if (next === selection) return level === null ? null : chooseEffort(level)
    setRefusal(null)
    if (!conversation) {
      const err = applyLocalModel(next, level)
      setRefusal(err)
      return err
    }
    const error = await app.command(conversation.sessionId, {
      type: 'set_model',
      model: next,
      reasoning: level ?? undefined,
    })
    setRefusal(error)
    return error
  }

  async function chooseEffort(profile: string | null): Promise<string | null> {
    setRefusal(null)
    if (!conversation) {
      const err = applyLocalEffort(profile)
      setRefusal(err)
      return err
    }
    const error = await app.command(conversation.sessionId, { type: 'set_reasoning', profile })
    setRefusal(error)
    return error
  }

  // ─── Send and cancel ──────────────────────────────────────────────────────

  /**
   * A submit whose outcome is not known yet: `text` is the draft that was sent.
   * It is cleared when its run starts; an engine refusal (`command_rejected`)
   * keeps it. `runsBefore` and `sentAt` tell the run and the refusal apart.
   * `restore` is the draft kept aside while browsing history (put back once
   * the recalled entry is sent); `skill` is the skill of a `/skill` line.
   */
  const [awaiting, setAwaiting] = useState<{
    sessionId: string
    sentAt: number
    runsBefore: number
    text: string
    restore: string | null
    skill: string | null
    /** Skills chosen for this message: no longer chosen once its run starts. */
    skills: string[]
  } | null>(null)

  const awaitingConv = awaiting ? (app.conversations.get(awaiting.sessionId) ?? null) : null
  useConversation(awaitingConv)

  /** Input history browsing: the draft kept aside while an older prompt is shown. */
  const [cursor] = useState(() => new HistoryCursor<DraftOwner>())

  /** The `/compact` sent from here: its progress and result show near the composer. */
  const [compactWatch, setCompactWatch] = useState<{ sessionId: string; sentAt: number } | null>(null)

  /** Active runs listed by `/quit`; `null` when the confirmation is closed. */
  const [quitRuns, setQuitRuns] = useState<string[] | null>(null)

  /**
   * The open conversation, or the single new one created for the project's
   * draft (shared by concurrent callers; the app state copies the draft into
   * it). `createdForRef` names the project whose draft is cleared once the first
   * submit is accepted.
   */
  const createdForRef = useRef<string | null>(null)
  async function ensureConversation(): Promise<{ conversation: Conversation } | { error: string }> {
    if (conversation) return { conversation }
    const projectId = project?.id ?? null
    const created = await app.startConversation(selection ?? undefined, effortValue ?? undefined)
    if (!created) return { error: app.lastError?.message ?? t('composer.couldNotCreateTheConversation') }
    createdForRef.current = projectId
    return { conversation: created }
  }

  /** After the first accepted submit of a new conversation, the project draft is spent. */
  function spendProjectDraft() {
    if (createdForRef.current) app.clearProjectDraft(createdForRef.current)
    createdForRef.current = null
  }

  async function send() {
    if (isSlashLine) return runSlashDraft()
    if (!canSend) {
      if (blocked) setRefusal(t('composer.removeTheFailedAttachmentsToSend'))
      return
    }
    setRefusal(null)
    const originOwner = owner
    const source = readDraft(originOwner)
    const text = source.text.trim()
    const skills = [...source.skills]

    const sentAt = Date.now()
    setSending(true)
    try {
      const ensured = await ensureConversation()
      if ('error' in ensured) {
        setRefusal(ensured.error)
        return
      }
      const target = ensured.conversation
      const runsBefore = target.runs.size
      const sentText = target.draft.text
      const blocks: PromptBlock[] = []
      if (text) blocks.push({ kind: 'text', text })
      try {
        const { blocks: attBlocks, promotedIds } = await attachmentBlocksFor(source, target.sessionId)
        blocks.push(...attBlocks)
        // The conversation's draft holds the same chips, now owned by it.
        if (promotedIds.size > 0) {
          target.setDraft({
            draftId: source.draftId,
            attachments: target.draft.attachments.map((a) =>
              promotedIds.has(a.id) ? { ...a, sessionId: target.sessionId } : a,
            ),
          })
          if (originOwner.kind !== 'conversation') {
            updateDraft(originOwner, (curr) => ({
              attachments: curr.attachments.map((a) =>
                promotedIds.has(a.id) ? { ...a, sessionId: target.sessionId } : a,
              ),
            }))
          }
        }
      } catch (e) {
        setRefusal(errorMessage(e))
        return
      }
      const prompt = skills.length > 0 ? { blocks, skills } : { blocks }
      const error = await app.command(target.sessionId, { type: 'submit', prompt })
      if (error) {
        setRefusal(error)
        return
      }
      spendProjectDraft()
      // A recalled entry was sent: the draft kept aside comes back once its run starts.
      const restore = cursor.end()
      setAwaiting({
        sessionId: target.sessionId,
        sentAt,
        runsBefore,
        text: sentText,
        restore: restore?.text ?? null,
        skill: null,
        skills,
      })
    } finally {
      setSending(false)
    }
  }

  // Settles the last submit: its draft goes when its run starts, and stays when
  // the engine refuses the submit or a `/skill` cannot be activated.
  const awaitingLastRejection = awaitingConv?.lastRejection ?? null
  const awaitingLastSkill = awaitingConv?.lastSkill ?? null
  const awaitingRunsSize = awaitingConv?.runs.size ?? 0

  useEffect(() => {
    if (!awaiting) return
    if (!awaitingConv) {
      setAwaiting(null)
      return
    }
    const refusedByEngine =
      awaitingLastRejection !== null &&
      awaitingLastRejection.command === 'submit' &&
      awaitingLastRejection.at >= awaiting.sentAt
    const skill = awaitingLastSkill
    const failed =
      awaiting.skill !== null && skill !== null && !skill.ok && skill.at >= awaiting.sentAt ? skill : null
    // A chosen skill the engine could not activate: its choice stays for the next message.
    const chosenRefused =
      skill !== null && !skill.ok && skill.at >= awaiting.sentAt && awaiting.skills.includes(skill.name)
    const started = awaitingRunsSize > awaiting.runsBefore
    if (!refusedByEngine && !failed && !started) return

    setAwaiting(null)
    if (failed) {
      setRefusal(
        t('composer.skillNotActivatedNothingWasSent', {
          name: failed.name,
          value: failed.reason ?? t('composer.unknownReason'),
        }),
      )
      return
    }
    if (refusedByEngine) return

    const nextSkills = chosenRefused
      ? awaitingConv.draft.skills
      : selectionAfterRun(awaitingConv.draft.skills, awaiting.skills)

    if (awaiting.restore !== null) {
      for (const a of awaitingConv.draft.attachments) revoke(a)
      awaitingConv.setDraft({
        text: awaiting.restore,
        attachments: [],
        skills: nextSkills,
      })
    } else if (awaitingConv.draft.text === awaiting.text) {
      for (const a of awaitingConv.draft.attachments) revoke(a)
      awaitingConv.setDraft({
        text: '',
        attachments: [],
        draftId: undefined,
        skills: nextSkills,
      })
    } else if (!chosenRefused) {
      awaitingConv.setDraft({ skills: nextSkills })
    }
  }, [awaiting, awaitingConv, awaitingLastRejection, awaitingLastSkill, awaitingRunsSize])

  const [dismissedRejectionAt, setDismissedRejectionAt] = useState<number | null>(null)
  const rejection = (() => {
    const r = conversation?.lastRejection
    if (!r || r.at === dismissedRejectionAt) return null
    return r
  })()
  const rejectionLabel = rejection ? (REJECTION_LABELS[rejection.command] ?? t('composer.commandRefused')) : null

  // The error banner above the editor: a refused command (the newest), else this composer's
  // own refusal, else the failed last run of the conversation. Closing it hides that error only.
  const [dismissedRunError, setDismissedRunError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const lastRunError = (() => {
    const conv = conversation
    if (!conv || running) return null
    for (let i = conv.items.length - 1; i >= 0; i--) {
      const item = conv.items[i]
      if (item.kind !== 'run_end') continue
      const error = runEndSummary(conv.runs.get(item.runId)).error
      return error ? { runId: item.runId, error } : null
    }
    return null
  })()

  const chatError: { view: ChatErrorView; source: 'rejection' | 'refusal' | 'run'; runId?: string } | null = (() => {
    if (rejection && rejectionLabel) {
      return { view: resolveChatError(rejection.reason, rejectionLabel), source: 'rejection' }
    }
    // The engine's refusal of a command also comes back as this composer's refusal: shown once.
    if (refusal && refusal !== conversation?.lastRejection?.reason) {
      return { view: resolveChatError(refusal), source: 'refusal' }
    }
    const failed = lastRunError
    if (failed && failed.runId !== dismissedRunError) {
      return { view: resolveChatError(failed.error), source: 'run', runId: failed.runId }
    }
    return null
  })()

  /** The message of the failed run, run again as it was. */
  const retryItem: UserItem | null = (() => {
    const runId = chatError?.source === 'run' ? chatError.runId : undefined
    if (!conversation || !runId) return null
    const sent = conversation.items.find((i): i is UserItem => i.kind === 'user' && i.runId === runId)
    return sent ?? null
  })()

  function dismissChatError() {
    const current = chatError
    if (!current) return
    if (current.source === 'rejection' && rejection) {
      setDismissedRejectionAt(rejection.at)
      if (refusal === rejection.reason) setRefusal(null)
    } else if (current.source === 'refusal') {
      setRefusal(null)
    } else if (current.runId) {
      setDismissedRunError(current.runId)
    }
  }

  async function retryRun() {
    const item = retryItem
    if (!conversation || !item || retrying) return
    setRetrying(true)
    try {
      setRefusal(await app.reviseMessage(conversation, item, item.text))
    } finally {
      setRetrying(false)
    }
  }

  /** Progress and result of the `/compact` sent from this composer. */
  const compactStatus = (() => {
    const w = compactWatch
    if (!w || conversation?.sessionId !== w.sessionId) return null
    const conv = app.conversations.get(w.sessionId)
    const done = conv?.lastCompaction
    if (done && done.at >= w.sentAt) return t('composer.compaction', { outcome: done.outcome })
    const refusedNow = conv?.lastRejection
    if (refusedNow && refusedNow.command === 'compact' && refusedNow.at >= w.sentAt) return null
    return t('common.compacting')
  })()

  async function cancel() {
    if (!conversation) return
    setRefusal(await app.command(conversation.sessionId, { type: 'cancel' }))
  }

  // ─── `/` lines ────────────────────────────────────────────────────────────

  /** Runs the `/` line of the draft. The engine parses it; nothing is sent as a prompt. */
  async function runSlashDraft() {
    if (!editable || sending || saving > 0) return
    setRefusal(null)
    const originOwner = owner
    const sentText = readDraft(originOwner).text
    setSending(true)
    try {
      const outcome = await runSlashLine(sentText.trim(), slashHost)
      settleSlash(outcome, sentText, originOwner)
    } finally {
      setSending(false)
    }
  }

  /** Clears the typed line, keeps it on a refusal, or starts watching what the engine answers. */
  function settleSlash(outcome: SlashOutcome, sentText: string, originOwner: DraftOwner) {
    switch (outcome.kind) {
      case 'refused':
        setRefusal(outcome.message)
        return
      case 'done': {
        // The line is consumed: a draft kept aside while browsing history comes back.
        updateDraft(originOwner, () => ({ text: cursor.end()?.text ?? '' }))
        return
      }
      case 'sent': {
        const { sessionId, sentAt, runsBefore, watch } = outcome
        const restore = cursor.end()?.text ?? null
        if (watch.kind === 'submit' || watch.kind === 'skill') {
          spendProjectDraft()
          setAwaiting({
            sessionId,
            sentAt,
            runsBefore,
            text: sentText,
            restore,
            skill: watch.kind === 'skill' ? watch.name : null,
            skills: [],
          })
          return
        }
        if (watch.kind === 'compact') setCompactWatch({ sessionId, sentAt })
        const targetConv = app.conversations.get(sessionId)
        if (targetConv) {
          targetConv.setDraft({ text: restore ?? '' })
        } else {
          updateDraft(originOwner, () => ({ text: restore ?? '' }))
        }
      }
    }
  }

  /** `/quit`: asks first when a run is active, then closes the application. */
  async function requestQuit(): Promise<string | null> {
    const active = [...app.conversations.values()]
      .filter((c) => c.running)
      .map((c) => c.title || t('composer.untitledConversation'))
    if (active.length > 0) {
      setQuitRuns(active)
      return null
    }
    try {
      await appQuit()
      return null
    } catch (e) {
      return errorMessage(e)
    }
  }

  /** What the `/` dispatcher needs from this composer. */
  const slashHost: SlashHost = {
    async parse(line) {
      try {
        return await slashParse(line)
      } catch (e) {
        throw new Error(errorMessage(e))
      }
    },
    currentSession: () => conversation?.sessionId ?? null,
    async ensureSession() {
      if (conversation) return { sessionId: conversation.sessionId }
      if (!project) return { error: t('composer.openAProjectToUseThis') }
      if (project.missing) return { error: t('composer.theProjectFolderCantBeFound') }
      if (!hasModels) return { error: t('composer.noModelConfigured') }
      const ensured = await ensureConversation()
      return 'error' in ensured ? ensured : { sessionId: ensured.conversation.sessionId }
    },
    mark: (sessionId) => ({
      sentAt: Date.now(),
      runsBefore: app.conversations.get(sessionId)?.runs.size ?? 0,
    }),
    send: (sessionId, command, display) => app.command(sessionId, command, display ?? null),
    async setModel(model, reasoning) {
      setRefusal(null)
      return applyLocalModel(model, reasoning)
    },
    async setEffort(profile) {
      setRefusal(null)
      return applyLocalEffort(profile)
    },
    openPicker: (picker) => ui.openPicker(picker),
    open: (view, args) => ui.open(view, args),
    openAgent: (agentId) => ui.openAgent(agentId),
    attachmentBlocks() {
      if (saving > 0 || importing) return { error: t('composer.waitForTheAttachmentToFinish') }
      if (blocked) return { error: t('composer.removeTheFailedAttachmentsToSend') }
      if (draft.attachments.some((a) => a.attachmentId)) {
        return { error: t('composer.sendAttachedFilesWithAMessage') }
      }
      return { blocks: draft.attachments.map(toBlock) }
    },
    resume: (sessionId) => app.resumeSession(sessionId),
    showChanges() {
      // The right panel's visibility is owned by the shell: see the report.
      app.setRightView('changes')
    },
    openSettings: (section) => ui.openSettings(section),
    attach: attachByPath,
    quit: requestQuit,
  }

  // ─── Skills for the next message ──────────────────────────────────────────

  function openSkills() {
    setRefusal(null)
    setSkillsOpen(true)
  }

  function closeSkills() {
    setSkillsOpen(false)
    editorRef.current?.focus()
  }

  /** Adds a skill to the next message, or removes it when already chosen (no file is touched). */
  function chooseSkill(name: string) {
    updateDraft(owner, (curr) => ({ skills: toggleSkill(curr.skills, name) }))
  }

  function removeSkill(name: string) {
    updateDraft(owner, (curr) => ({ skills: curr.skills.filter((n) => n !== name) }))
  }

  // ─── Palette `/` ──────────────────────────────────────────────────────────

  /** The palette hides after Esc until the draft changes. */
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [paletteIndex, setPaletteIndex] = useState(0)

  const slashCommands = registryState.status === 'ready' ? registryState.commands : null
  const paletteName = paletteQuery(draft.text.trimStart())
  const paletteItems: SlashCommandInfo[] = slashCommands
    ? filterCommands(slashCommands, paletteName ?? '')
    : []
  const paletteOpen = paletteName !== null && editable && dismissedFor !== draft.text
  const activeIndex = Math.min(paletteIndex, Math.max(paletteItems.length - 1, 0))
  const activeCommand: SlashCommandInfo | undefined = paletteItems[activeIndex]
  const paletteListShown =
    paletteOpen && registryState.status === 'ready' && paletteItems.length > 0

  // ─── `@` mentions ────────────────────────────────────────────────────────

  /** Caret position in the editor, kept in step with the text. */
  const [caret, setCaret] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  /** The `@` popover hides after Esc until the draft changes. */
  const [mentionDismissedFor, setMentionDismissedFor] = useState<string | null>(null)

  const mention: MentionToken | null = editable ? mentionAt(draft.text, caret) : null
  const mentionOpen = mention !== null && !paletteOpen && mentionDismissedFor !== draft.text
  const mentionActiveIndex = Math.min(mentionIndex, Math.max(filesState.items.length - 1, 0))
  const mentionActive: ProjectFileEntry | undefined = filesState.items[mentionActiveIndex]

  /** The popup the editor points at: the command palette wins over `@`. */
  const popupId = paletteOpen ? paletteId : mentionOpen ? mentionId : null
  const popupShown = paletteOpen ? paletteListShown : mentionOpen && filesState.items.length > 0
  const popupActive = paletteOpen ? activeIndex : mentionActiveIndex

  /** Puts the caret at `pos` once the text is rendered. */
  function moveCaret(pos: number) {
    setCaret(pos)
    pendingCaretRef.current = pos
    queueMicrotask(() => {
      if (pendingCaretRef.current === pos) {
        const el = editorRef.current
        if (el && el.value.length >= pos) {
          el.setSelectionRange(pos, pos)
          pendingCaretRef.current = null
        }
      }
    })
  }

  useLayoutEffect(() => {
    const pos = pendingCaretRef.current
    if (pos === null) return
    pendingCaretRef.current = null
    const el = editorRef.current
    if (el) el.setSelectionRange(pos, pos)
  }, [draft.text])

  /** Keeps the caret state in step with the editor (typing, arrows, clicks). */
  function syncCaret() {
    const el = editorRef.current
    if (el) setCaret(el.selectionStart)
  }

  /** Completes the name of a command (Tab, Enter on an incomplete name, or a click). */
  function completeWith(cmd: SlashCommandInfo) {
    const nextText = completeLine(cmd)
    updateDraft(owner, () => ({ text: nextText }))
    setPaletteIndex(0)
    setDismissedFor(null)
    moveCaret(nextText.length)
    editorRef.current?.focus()
  }

  /** Keys handled while the palette is open. Returns true when the key was used. */
  function onPaletteKey(e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
    const count = paletteItems.length
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (count === 0) return false
        e.preventDefault()
        setPaletteIndex(moveIndex(activeIndex, e.key === 'ArrowDown' ? 1 : -1, count))
        return true
      case 'Tab': {
        const cmd = activeCommand
        if (!cmd || e.shiftKey) return false
        e.preventDefault()
        completeWith(cmd)
        return true
      }
      case 'Enter': {
        const cmd = activeCommand
        // A complete name runs the command (the normal Enter path); an incomplete one is completed first.
        if (!cmd || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false
        if (isExactName(paletteName ?? '', cmd)) return false
        e.preventDefault()
        completeWith(cmd)
        return true
      }
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        setDismissedFor(draft.text)
        return true
      default:
        return false
    }
  }

  /** Rebuilds the project's file index (« Actualiser », Ctrl+R). */
  function refreshMentions() {
    const pid = project?.id
    if (!pid || !mention) return
    files.refresh(pid, mention.query)
  }

  /**
   * Attaches a project entry (folder, image or file) and removes its `@` token
   * from the text. An entry that has vanished since the listing becomes an error chip.
   */
  async function attachEntry(entry: ProjectFileEntry) {
    const token = mention
    const root = app.currentProject
    if (!token || !root || !editable || sending) return
    const targetOwner = owner
    const current = readDraft(targetOwner)
    const next = removeMention(current.text, token)
    updateDraft(targetOwner, () => ({ text: next.text }))
    setMentionIndex(0)
    moveCaret(next.caret)
    const path = projectEntryPath(root.path, entry.path)
    let found: 'file' | 'folder' | 'missing'
    try {
      found = await pathKind(path)
    } catch (e) {
      updateDraft(targetOwner, (curr) => ({
        attachments: [
          ...curr.attachments,
          { id: crypto.randomUUID(), kind: 'file', path, name: basename(path), error: errorMessage(e) },
        ],
      }))
      return
    }
    if (found === 'missing') {
      updateDraft(targetOwner, (curr) => ({
        attachments: [
          ...curr.attachments,
          { id: crypto.randomUUID(), kind: 'file', path, name: basename(path), error: t('composer.itemNotFound') },
        ],
      }))
      return
    }
    addPath(targetOwner, path, found)
  }

  /** Keys handled while the `@` popover is open. Returns true when the key was used. */
  function onMentionKey(e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
    if (e.ctrlKey && e.key.toLowerCase() === 'r') {
      e.preventDefault()
      refreshMentions()
      return true
    }
    const count = filesState.items.length
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (count === 0) return false
        e.preventDefault()
        setMentionIndex(moveIndex(mentionActiveIndex, e.key === 'ArrowDown' ? 1 : -1, count))
        return true
      case 'Tab': {
        const entry = mentionActive
        if (!entry || e.shiftKey) return false
        e.preventDefault()
        void attachEntry(entry)
        return true
      }
      case 'Enter': {
        const entry = mentionActive
        if (!entry || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false
        e.preventDefault()
        void attachEntry(entry)
        return true
      }
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        setMentionDismissedFor(draft.text)
        return true
      default:
        return false
    }
  }

  // ─── Input history ────────────────────────────────────────────────────────

  /** Earlier prompts of the open conversation, oldest first. */
  function historyEntries(): string[] {
    const out: string[] = []
    for (const item of conversation?.items ?? []) {
      if (item.kind === 'user' && item.text.trim() !== '') out.push(item.text)
    }
    // A send whose run has not started yet is not in the timeline.
    if (awaiting && conversation && awaiting.sessionId === conversation.sessionId) {
      if (awaiting.text.trim() !== '') out.push(awaiting.text)
    }
    return out
  }

  /** ↑ / ↓ recall earlier prompts. Returns true when the key was used. */
  function recall(e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
    const el = editorRef.current
    if (!el) return false
    const caretState = {
      text: draft.text,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
      browsing: cursor.browsing,
    }
    const next =
      e.key === 'ArrowUp'
        ? shouldRecallOlder(caretState)
          ? cursor.older(historyEntries(), draft.text, owner)
          : null
        : shouldRecallNewer(caretState)
          ? cursor.newer(historyEntries())
          : null
    if (next === null) return false
    e.preventDefault()
    updateDraft(owner, () => ({ text: next }))
    moveCaret(next.length)
    return true
  }

  // ─── Keyboard and editor ──────────────────────────────────────────────────

  function onEditorChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const value = e.currentTarget.value
    const nextCaret = e.currentTarget.selectionStart
    updateDraft(owner, () => ({ text: value }))
    setPaletteIndex(0)
    setMentionIndex(0)
    setCaret(nextCaret)
    // Typing `/` opens the palette: a list that failed to load is asked again then.
    if (value === '/') void slashRegistry.load()
  }

  /** Enter sends (Cmd/Ctrl+Enter too); Shift+Enter is a newline; IME composition is left alone. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (paletteOpen && onPaletteKey(e)) return
    if (mentionOpen && onMentionKey(e)) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) recall(e)
      return
    }
    if (e.key !== 'Enter' || e.shiftKey || e.altKey) return
    e.preventDefault()
    // While a run is going, a prompt waits; a `/` line still runs (its command decides).
    if (running && !isSlashLine) return
    void send()
  }

  // Focus the editor when a conversation opens; a recalled entry is kept aside
  // in the conversation it came from and put back when the conversation changes.
  const sessionId = conversation?.sessionId
  useEffect(() => {
    const saved = cursor.end()
    if (saved) updateDraftFor(saved.owner, setLocalDraft, () => ({ text: saved.text }))
    // A new conversation's text: the caret is at its end until the editor reports otherwise.
    setCaret(draftTextRef.current.length)
    editorRef.current?.focus()
  }, [sessionId, cursor])

  // « Nouvelle conversation » (any entry point) asks the composer for focus.
  const composerFocus = app.composerFocus
  useEffect(() => {
    if (composerFocus === 0) return
    editorRef.current?.focus()
  }, [composerFocus])

  // Searches the project files for the text after `@` while the popover is open.
  const mentionQuery = mentionOpen && mention ? mention.query : null
  const projectId = project?.id ?? null
  useEffect(() => {
    if (mentionQuery === null || projectId === null) return
    files.search(projectId, mentionQuery)
  }, [files, projectId, mentionQuery])

  // `/model` and `/effort` open their select (the request is consumed here).
  const picker = uiStore.picker
  useEffect(() => {
    if (picker === null) return
    uiStore.clearPicker()
    if (!editable) {
      setRefusal(t('composer.chooseAProjectAndAModel'))
      return
    }
    if (picker === 'model') {
      setModelOpen(true)
      return
    }
    if (!choice || choice.profiles.length === 0) {
      setRefusal(t('composer.thisModelHasNoEffortProfile'))
      return
    }
    setModelOpen(true)
  }, [picker, editable, choice, uiStore])

  // Manual auto-grow where CSS field-sizing is missing (the class handles the rest).
  useLayoutEffect(() => {
    const el = editorRef.current
    if (!el || HAS_FIELD_SIZING) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft.text])

  return (
    <>
      <section ref={rootRef} aria-label={t('common.messageInput')} className="shrink-0 px-4 pt-1 pb-3">
        <div className="mx-auto flex max-w-3xl flex-col">
          {chatError && (
            <div className="mb-3 w-full shrink-0">
              <ChatErrorBanner
                error={chatError.view}
                onDismiss={dismissChatError}
                onOpenModelSettings={() => ui.openSettings('models')}
                onRetry={retryItem ? () => void retryRun() : undefined}
                retryDisabled={retrying || running}
              />
            </div>
          )}

          {/* Notices sit on a strip tucked under the card: the card overlaps its lower edge. */}
          {compactStatus && (
            <div className="relative z-0 mx-2 -mb-3.5 flex flex-col gap-1 rounded-t-2xl bg-popover px-3.5 pt-1.5 pb-5 text-xs">
              <p className="py-0.5 text-muted-foreground" role="status">
                {compactStatus}
              </p>
            </div>
          )}

          <div
            className={cn(
              'relative z-10 mx-1 mt-1 flex flex-col rounded-xl border border-border bg-card shadow-composer transition-[border-color,box-shadow] duration-200 focus-within:border-border-strong focus-within:shadow-md',
              dragging && 'border-ring bg-element-hover',
            )}
          >
            {paletteOpen && (
              <CommandPalette
                id={paletteId}
                items={paletteItems}
                activeIndex={activeIndex}
                status={registryState.status}
                error={registryState.status === 'error' ? registryState.message : ''}
                query={paletteName ?? ''}
                onPick={completeWith}
                onHover={setPaletteIndex}
              />
            )}

            {mentionOpen && (
              <MentionPalette
                id={mentionId}
                items={filesState.items}
                activeIndex={mentionActiveIndex}
                status={filesState.status}
                error={filesState.error}
                query={mention?.query ?? ''}
                onPick={(entry) => void attachEntry(entry)}
                onHover={setMentionIndex}
                onRefresh={refreshMentions}
              />
            )}

            {skillsOpen && (
              <SkillPicker
                conversation={conversation}
                projectId={project?.id ?? null}
                selected={draft.skills}
                onToggle={chooseSkill}
                onClose={closeSkills}
              />
            )}

            {dragging && (
              <p className="px-4 pt-3 text-sm text-muted-foreground">
                {t('composer.dropTheFilesToAttachThem')}
              </p>
            )}

            {draft.attachments.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 px-3 pt-2.5 pr-12" aria-label={t('common.attachments')}>
                {draft.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <AttachmentChip
                      attachment={attachment}
                      error={chipError(attachment)}
                      onRemove={() => removeAttachment(attachment.id)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {draft.skills.length > 0 && (
              <ul
                className="flex flex-wrap gap-1.5 px-3 pt-2.5 pr-12"
                aria-label={t('composer.skillsForTheNextMessage')}
              >
                {draft.skills.map((name) => (
                  <li
                    key={name}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-transparent bg-muted/60 py-1 pr-1 pl-1.5 text-sm"
                  >
                    <SparklesIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 max-w-56 truncate font-mono text-xs" title={name}>
                      {name}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('composer.removeSkill', { name })}
                      onClick={() => removeSkill(name)}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {saving > 0 && (
              <p className="px-4 pt-2 text-xs text-muted-foreground" role="status">
                {t('composer.copyingAttachments')}
              </p>
            )}

            <Textarea
              ref={editorRef}
              rows={1}
              value={draft.text}
              onChange={onEditorChange}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              disabled={!editable}
              readOnly={sending}
              placeholder={placeholder}
              aria-label={t('composer.message')}
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={paletteOpen || mentionOpen}
              aria-controls={popupShown && popupId ? popupId : undefined}
              aria-activedescendant={popupShown && popupId ? `${popupId}-opt-${popupActive}` : undefined}
              onKeyUp={syncCaret}
              onClick={syncCaret}
              onSelect={syncCaret}
              dir="auto"
              className="max-h-[200px] min-h-[44px] resize-none overflow-y-auto rounded-xl border-0 bg-transparent py-3 pr-12 pl-4 text-ui leading-[1.55] text-start shadow-none focus-visible:ring-0 dark:bg-transparent"
            />

            {/* Send or stop: one square in the card's top right corner. */}
            <div className="absolute top-2 right-2">
              {running && !isSlashLine ? (
                <Button
                  variant="outline"
                  size="icon-compact"
                  className="size-7 rounded-lg border-border bg-background p-0 text-foreground shadow-none hover:bg-element-hover"
                  aria-label={t('composer.stopGenerating')}
                  title={t('common.stop')}
                  onClick={() => void cancel()}
                >
                  <SquareIcon className="size-2.5 fill-current" aria-hidden="true" />
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon-compact"
                      className="size-7 rounded-lg border-border bg-background p-0 text-foreground shadow-none hover:bg-element-hover disabled:border-transparent disabled:text-muted-foreground"
                      aria-label={t('composer.sendMessage')}
                      disabled={!canSend && !slashReady}
                      onClick={() => void send()}
                    >
                      <ArrowUpIcon className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('common.send')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          {/* The tray, attached under the card. */}
          <div className="mx-5 flex flex-wrap items-center gap-1.5 rounded-b-xl border border-t-0 border-border bg-panel-input px-2 pt-2 pb-1.5">
            <AttachMenu
              disabled={!editable || sending}
              onPick={(paths, kind) => addPicked(paths, kind === 'folder')}
              onError={(message) => setRefusal(message)}
              onSkills={openSkills}
            />
            <ModelSelect
              open={modelOpen}
              onOpenChange={setModelOpen}
              value={selection}
              level={effortEffective}
              models={app.models}
              disabled={!editable}
              onPick={pickModel}
            />
            <div className="ml-auto flex items-center gap-1.5">
              <ContextGauge conversation={conversation} />
            </div>
          </div>
        </div>
      </section>

      <QuitDialog runs={quitRuns} onClose={() => setQuitRuns(null)} />
    </>
  )
}

export default Composer
