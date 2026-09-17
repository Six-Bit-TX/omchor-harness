/**
 * The timeline dialog: one file's commits, newest first.
 *
 * A file outside a repository, one never committed, or a Host without git all
 * answer with no commits, and that is what the empty line says. A date is drawn
 * through the dictionary's own template rather than `toLocaleString`: the
 * browser's language is not the app's, and a switch would otherwise leave the
 * two mixed in one row.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceFileHistory } from '@deepseek-ai/dsh-api-workspace-files/types'
import { actionFailureLine } from './failures.ts'
import type {} from './locales.ts'
import css from './FilesBody.module.css'

/** Everything the timeline dialog draws and the read it performs. */
export interface TimelineDialogProps {
  /** Absolute path of the file whose history is shown. */
  readonly path: string
  /** Namespace-bound translate. */
  readonly t: TranslateNS<'sidebarFiles'>
  /**
   * Read one file's git history.
   * @param path - absolute path of the file.
   */
  readonly loadHistory: (path: string) => Promise<RemoteResult<WorkspaceFileHistory>>
  /** Dismiss the dialog. */
  readonly onClose: () => void
}

/** One commit's author date, through the dictionary's date template. */
function dateLabel(date: string, t: TranslateNS<'sidebarFiles'>): string {
  const at = new Date(Date.parse(date))
  const pad = (value: number): string => String(value).padStart(2, '0')
  return t('timeline.date', {
    y: at.getFullYear(),
    m: pad(at.getMonth() + 1),
    d: pad(at.getDate()),
    h: pad(at.getHours()),
    mi: pad(at.getMinutes()),
  })
}

/**
 * Render one file's commit history.
 * @param props - see {@link TimelineDialogProps}.
 * @returns the dialog element.
 */
export function TimelineDialog({ path, t, loadHistory, onClose }: TimelineDialogProps): ReactNode {
  const [history, setHistory] = useState<WorkspaceFileHistory | null>(null)
  const [failure, setFailure] = useState<RemoteFailure | null>(null)
  useEffect(() => {
    setHistory(null)
    setFailure(null)
    void loadHistory(path).then((result) => {
      if (result.ok) setHistory(result.value)
      else setFailure(result.error)
    })
  }, [path, loadHistory])

  return (
    <Modal
      open
      title={t('timeline.title')}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      className={css.timelineDialog ?? ''}
    >
      <div className={css.timelinePath} data-timeline-path>{path}</div>
      {failure !== null && (
        <p className={css.dialogError} role="alert" data-timeline-failure>{actionFailureLine(t, failure)}</p>
      )}
      {failure === null && history === null && (
        <p className={css.dialogNote} data-timeline-loading>{t('loading')}</p>
      )}
      {history !== null && history.entries.length === 0 && (
        <p className={css.dialogNote} data-timeline-empty>{t('timeline.empty')}</p>
      )}
      {history !== null && history.entries.length > 0 && (
        <ul className={css.timelineList}>
          {history.entries.map(entry => (
            <li key={entry.hash} className={css.timelineRow} data-timeline-entry={entry.shortHash}>
              <span className={css.timelineHash}>{entry.shortHash}</span>
              <span className={css.timelineSubject}>{entry.subject}</span>
              <span className={css.timelineMeta}>
                {t('timeline.meta', { author: entry.author, date: dateLabel(entry.date, t) })}
              </span>
              {entry.additions + entry.deletions > 0 && (
                <span className={css.timelineCounts} data-timeline-counts>
                  {t('timeline.counts', { additions: entry.additions, deletions: entry.deletions })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
