import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setLanguage } from '$lib/i18n/i18n'
import type { UpdateMetadata, UpdateStatus } from '$lib/ipc/client'
import {
  downloadPercent,
  formatBytes,
  formatDownloadProgress,
  formatPubDate,
  hasActionableUpdate,
  metadataOf,
  updateTooltipLabel,
} from '$lib/features/updates/updates'

const META: UpdateMetadata = {
  current_version: '2026.11.14',
  version: '2026.11.15',
  pub_date: '2026-11-15T12:00:00Z',
  notes: 'Bug fixes',
}

describe('updates helpers', () => {
  beforeEach(() => {
    setLanguage('en')
  })

  it('formats bytes and percentages', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB')
    expect(downloadPercent(50, 200)).toBe(25)
    expect(downloadPercent(50, null)).toBeNull()
    expect(formatDownloadProgress(500, 1000)).toBe('500 B / 1000 B (50%)')
    expect(formatDownloadProgress(1024 * 1024, null)).toBe('1.0 MB')
  })

  it('extracts metadata and actionable status correctly', () => {
    const idle: UpdateStatus = { phase: 'idle' }
    const avail: UpdateStatus = { phase: 'available', info: META }
    const dl: UpdateStatus = {
      phase: 'downloading',
      info: META,
      downloaded_bytes: 50,
      total_bytes: 100,
    }
    const ready: UpdateStatus = { phase: 'ready', info: META }
    const errNoInfo: UpdateStatus = { phase: 'error', message: 'offline', info: null }
    const errWithInfo: UpdateStatus = { phase: 'error', message: 'timeout', info: META }

    expect(hasActionableUpdate(idle)).toBe(false)
    expect(hasActionableUpdate(errNoInfo)).toBe(false)
    expect(hasActionableUpdate(avail)).toBe(true)
    expect(hasActionableUpdate(dl)).toBe(true)
    expect(hasActionableUpdate(ready)).toBe(true)
    expect(hasActionableUpdate(errWithInfo)).toBe(true)

    expect(metadataOf(idle)).toBeNull()
    expect(metadataOf(avail)).toEqual(META)
    expect(metadataOf(errWithInfo)).toEqual(META)
  })

  it('formats tooltip labels in English and French', () => {
    const ready: UpdateStatus = { phase: 'ready', info: META }
    expect(updateTooltipLabel(ready)).toContain('2026.11.15')
    setLanguage('fr')
    expect(updateTooltipLabel(ready)).toContain('redémarrer')
  })

  it('formats publication dates or passes invalid dates through', () => {
    expect(formatPubDate(null)).toBeNull()
    expect(formatPubDate('not-a-date')).toBe('not-a-date')
    expect(formatPubDate('2026-11-15T12:00:00Z')).toBeTruthy()
  })
})

describe('updater UI placement', () => {
  it('places green ArrowDownToLine button next to Settings in NavigationPanel without border-t', () => {
    const nav = readFileSync(
      resolve(import.meta.dirname, '../../src/lib/features/navigation/NavigationPanel.tsx'),
      'utf8',
    )
    expect(nav).toMatch(/import\s*\{[^}]*\bArrowDownToLineIcon\b[^}]*\}\s*from 'lucide-react'/)
    expect(nav).toContain('bg-emerald-600 text-white')
    expect(nav).toContain('flex-1 justify-start text-ui')
    const footerStart = nav.indexOf('flex items-center gap-1.5')
    expect(footerStart).toBeGreaterThan(-1)
    const footer = nav.slice(footerStart)
    expect(footer).toContain('ui.setSettingsOpen(true)')
    expect(footer).not.toContain('border-t')
  })

  it('places a shadcn/ui update check button in ApplicationSettings', () => {
    const settings = readFileSync(
      resolve(import.meta.dirname, '../../src/lib/features/settings/ApplicationSettings.tsx'),
      'utf8',
    )
    expect(settings).toContain("import { Button } from '$lib/components/ui/button'")
    expect(settings).toContain("t('updates.checkForUpdates')")
  })
})
