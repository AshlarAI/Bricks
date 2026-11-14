import type { UpdateMetadata, UpdateStatus } from '$lib/ipc/client'
import { dateTimeFormat, t } from '$lib/i18n/i18n.svelte'

const pubDateFormatter = dateTimeFormat({ dateStyle: 'medium' })

/** Format a byte count into a compact human-readable label (KB/MB/GB). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx++
  }
  const decimals = idx >= 2 ? 1 : 0
  return `${value.toFixed(decimals)} ${units[idx]}`
}

/** Percentage (0..100) for a download status, or `null` when content-length is unknown. */
export function downloadPercent(downloaded: number, total: number | null | undefined): number | null {
  if (total == null || total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)))
}

/** Progress text shown during download: e.g. `42%` or `12.4 MB / 29.5 MB`. */
export function formatDownloadProgress(downloaded: number, total: number | null | undefined): string {
  const pct = downloadPercent(downloaded, total)
  if (pct != null && total != null && total > 0) {
    return `${formatBytes(downloaded)} / ${formatBytes(total)} (${pct}%)`
  }
  return formatBytes(downloaded)
}

/** Short release date formatted for the current UI locale, or `null`. */
export function formatPubDate(pubDate: string | null | undefined): string | null {
  if (!pubDate) return null
  const date = new Date(pubDate)
  if (Number.isNaN(date.getTime())) return pubDate
  return pubDateFormatter.format(date)
}

/** Extract `UpdateMetadata` attached to a status, when present. */
export function metadataOf(status: UpdateStatus): UpdateMetadata | null {
  switch (status.phase) {
    case 'available':
    case 'downloading':
    case 'ready':
      return status.info
    case 'error':
      return status.info ?? null
    case 'idle':
    case 'checking':
    case 'up_to_date':
      return null
  }
}

/** Whether the green footer update button should be shown in the sidebar. */
export function hasActionableUpdate(status: UpdateStatus): boolean {
  return (
    status.phase === 'available' ||
    status.phase === 'downloading' ||
    status.phase === 'ready' ||
    (status.phase === 'error' && status.info != null)
  )
}

/** Localized tooltip / status label for an actionable update status. */
export function updateTooltipLabel(status: UpdateStatus): string {
  switch (status.phase) {
    case 'available':
      return t('updates.updateAvailableBadge', { version: status.info.version })
    case 'downloading':
      return t('updates.updateDownloadingBadge', {
        version: status.info.version,
        progress: formatDownloadProgress(status.downloaded_bytes, status.total_bytes),
      })
    case 'ready':
      return t('updates.updateReadyBadge', { version: status.info.version })
    case 'error':
      return status.info
        ? t('updates.updateAvailableBadge', { version: status.info.version })
        : t('updates.checkFailed', { message: status.message })
    case 'checking':
      return t('updates.checkingHint')
    case 'up_to_date':
      return t('updates.upToDate')
    case 'idle':
      return t('updates.checkForUpdates')
  }
}
