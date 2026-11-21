// Settings of Bricks, over the whole window: on the left « Retour à l'espace de travail », a
// search and the sections by group; on the right the section, under its title. The workspace
// stays mounted underneath (its conversations, drafts and scroll wait for the way back).
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import {
  AppWindowIcon,
  ArrowLeftIcon,
  BrainIcon,
  ChartColumnIcon,
  CpuIcon,
  PaletteIcon,
  PlugIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '$lib/components/ui/input-group'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '$lib/components/ui/sidebar'
import { t, useLanguage } from '$lib/i18n/i18n'
import { TOP_BAR } from '$lib/layout/constants'
import { ui, useUi } from '$lib/state/ui'
import AppearanceSettings from './AppearanceSettings'
import ApplicationSettings from './ApplicationSettings'
import ExtensionsSettings from './ExtensionsSettings'
import GeneralSettings from './GeneralSettings'
import MemorySettings from './MemorySettings'
import ModelSettings from './ModelSettings'
import SkillsSettings from './SkillsSettings'
import UsageSettings from './UsageSettings'

type SectionId =
  | 'general'
  | 'appearance'
  | 'models'
  | 'application'
  | 'memory'
  | 'skills'
  | 'extensions'
  | 'usage'

interface Section {
  id: SectionId
  label: string
  icon: ComponentType<{ className?: string }>
  content: ComponentType
}

const GROUPS: { label: string; sections: Section[] }[] = [
  {
    get label() { return t('settings.groupBasics') },
    sections: [
      { id: 'general', get label() { return t('settings.general') }, icon: SlidersHorizontalIcon, content: GeneralSettings },
      { id: 'appearance', get label() { return t('settings.appearance') }, icon: PaletteIcon, content: AppearanceSettings },
      { id: 'models', get label() { return t('settings.models') }, icon: CpuIcon, content: ModelSettings },
      { id: 'application', get label() { return t('settings.application') }, icon: AppWindowIcon, content: ApplicationSettings },
    ],
  },
  {
    get label() { return t('settings.groupAgent') },
    sections: [
      { id: 'memory', get label() { return t('common.memory') }, icon: BrainIcon, content: MemorySettings },
      { id: 'skills', get label() { return t('common.skills') }, icon: SparklesIcon, content: SkillsSettings },
      { id: 'extensions', get label() { return t('settings.extensions') }, icon: PlugIcon, content: ExtensionsSettings },
    ],
  },
  {
    get label() { return t('settings.groupData') },
    sections: [
      { id: 'usage', get label() { return t('common.usage') }, icon: ChartColumnIcon, content: UsageSettings },
    ],
  },
]

const SECTIONS = GROUPS.flatMap((g) => g.sections)

/** Lower case, accents removed: « mémoire » matches « memoire ». */
const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export interface SettingsPageProps {
  /** macOS draws its window buttons over the top left corner. */
  systemButtons?: boolean
}

export function SettingsPage({ systemButtons = false }: SettingsPageProps) {
  useLanguage()
  const settingsSection = useUi((s) => s.settingsSection)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const [section, setSection] = useState<SectionId>(() => {
    const wanted = SECTIONS.find((s) => s.id === ui.settingsSection)?.id
    return wanted ?? 'general'
  })
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!settingsSection) return
    const wanted = SECTIONS.find((s) => s.id === settingsSection)?.id
    if (wanted) setSection(wanted)
    ui.clearSettingsSection()
  }, [settingsSection])

  /** The workspace behind is inert: focus starts on « Retour à l'espace de travail ». */
  useEffect(() => {
    containerRef.current?.querySelector<HTMLElement>('[data-sidebar="menu-button"]')?.focus()
  }, [])

  const close = useCallback(() => {
    ui.setSettingsOpen(false)
  }, [])

  /** Escape goes back to the workspace; a dialog, menu or list open over the page keeps its own. */
  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) {
        return
      }
      close()
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [close])

  const wantedQuery = fold(query.trim())
  const groups =
    wantedQuery === ''
      ? GROUPS
      : GROUPS.map((g) => ({
          label: g.label,
          sections: g.sections.filter((s) => fold(s.label).includes(wantedQuery)),
        })).filter((g) => g.sections.length > 0)

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]
  const CurrentContent = current.content

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-40 flex bg-sidebar"
      role="region"
      aria-label={t('common.bricksSettings')}
    >
      <SidebarProvider className="min-h-0">
        <Sidebar collapsible="none">
          <div
            data-tauri-drag-region
            className="shrink-0"
            style={{
              height: `${TOP_BAR.height}px`,
              marginLeft: systemButtons ? `${TOP_BAR.macSystemButtons}px` : undefined,
            }}
          />
          <SidebarHeader className="pt-0">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={close}>
                  <ArrowLeftIcon />
                  <span>{t('settings.backToWorkspace')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <InputGroup className="bg-background">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                placeholder={t('settings.searchSettings')}
                aria-label={t('settings.searchSettings')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
          </SidebarHeader>
          <SidebarContent>
            {groups.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.sections.map((item) => {
                      const Icon = item.icon
                      return (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            isActive={section === item.id}
                            onClick={() => setSection(item.id)}
                          >
                            <Icon />
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
        </Sidebar>

        <SidebarInset className="m-2 ml-0 min-h-0 overflow-hidden rounded-xl border border-border">
          <div data-tauri-drag-region className="h-8 shrink-0" />
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-10 pb-16">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {current.label}
              </h1>
              <CurrentContent key={current.id} />
            </div>
          </ScrollArea>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

export default SettingsPage
