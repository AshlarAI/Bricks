// The icon of each tool, by its real name. A call's state is said in words only
// when it failed; the icon says what the call does. Pure: unit-tested
// (tests/unit/tool-icons.test.ts).
import {
  AppWindowIcon,
  BinocularsIcon,
  BookOpenCheckIcon,
  BotIcon,
  BracesIcon,
  BrainIcon,
  CameraIcon,
  ChartLineIcon,
  CodeIcon,
  CpuIcon,
  DatabaseIcon,
  FileDiffIcon,
  FolderSearchIcon,
  GlobeIcon,
  ImageIcon,
  KeyboardIcon,
  ListChecksIcon,
  ListTodoIcon,
  MailIcon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  PackageOpenIcon,
  PenIcon,
  PenLineIcon,
  PlayIcon,
  PlugIcon,
  ScanEyeIcon,
  SearchIcon,
  SquareDashedMousePointerIcon,
  TerminalIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react'
import type { IconComponent } from '$lib/layout/types'

const COMPUTER_USE_PREFIX = 'mcp__computer-use__'

const COMPUTER_USE_ICONS: Record<string, IconComponent> = {
  type_text: KeyboardIcon,
  press_key: KeyboardIcon,
  hotkey: KeyboardIcon,
  set_value: KeyboardIcon,
  get_desktop_state: CameraIcon,
  get_window_state: CameraIcon,
  zoom: CameraIcon,
  get_accessibility_tree: ScanEyeIcon,
  parse_visual_regions: ScanEyeIcon,
  verify_state: ScanEyeIcon,
  page: GlobeIcon,
  run_steps: ListChecksIcon,
  run_script: PlayIcon,
  launch_app: AppWindowIcon,
  bring_to_front: AppWindowIcon,
  list_windows: AppWindowIcon,
  list_apps: AppWindowIcon,
  set_window_frame: AppWindowIcon,
  invoke_menu: AppWindowIcon,
  kill_app: AppWindowIcon,
}

const BY_NAME: Record<string, IconComponent> = {
  Bash: TerminalIcon,
  bash: TerminalIcon,
  Shell: TerminalIcon,
  PowerShell: TerminalIcon,
  Read: BookOpenCheckIcon,
  Grep: SearchIcon,
  Search: SearchIcon,
  CodeSearch: SearchIcon,
  CodeScout: CodeIcon,
  CodeStats: ChartLineIcon,
  Job: CpuIcon,
  Write: PenIcon,
  Edit: PenLineIcon,
  MultiEdit: PenLineIcon,
  NotebookEdit: PenLineIcon,
  ApplyPatch: FileDiffIcon,
  Glob: FolderSearchIcon,
  ViewImage: ImageIcon,
  WebFetch: GlobeIcon,
  WebSearch: BinocularsIcon,
  TodoWrite: ListTodoIcon,
  Ask: MessageCircleQuestionIcon,
  Agent: BotIcon,
  Managent: BotIcon,
  Messagent: MailIcon,
  LoadTools: PackageOpenIcon,
  Skill: ZapIcon,
  LSP: BracesIcon,
  memory_search: DatabaseIcon,
  memory_list: DatabaseIcon,
  memory_write: DatabaseIcon,
  memory_update: DatabaseIcon,
  memory_delete: DatabaseIcon,
}

/** The step of a run that is reasoning, not calling a tool. */
export const THINKING_ICON: IconComponent = BrainIcon
/** The step of a run that is writing a message. */
export const MESSAGE_ICON: IconComponent = MessageSquareIcon

export function toolIcon(name: string): IconComponent {
  const known = BY_NAME[name]
  if (known) return known
  if (name.startsWith(COMPUTER_USE_PREFIX)) {
    const action = name.slice(COMPUTER_USE_PREFIX.length)
    if (action.startsWith('browser_')) return GlobeIcon
    return COMPUTER_USE_ICONS[action] ?? SquareDashedMousePointerIcon
  }
  if (name.startsWith('mcp__')) return PlugIcon
  return WrenchIcon
}
