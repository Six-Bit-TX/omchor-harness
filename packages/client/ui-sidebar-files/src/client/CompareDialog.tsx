/**
 * The compare dialog: two files side by side, rendered as the change between
 * them, and the two paths the comparison is between.
 *
 * Each side is read as one bounded page; a side the Host cut leaves the reader
 * with a note rather than a silently partial answer. The diff itself is the
 * shared `DiffBlock`, so a comparison here reads exactly like every other
 * change surface.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DiffBlock, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiffBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { actionFailureLine } from './failures.ts'
import type { FilePage } from './face.ts'
import type {} from './locales.ts'
import css from './FilesBody.module.css'

/** Everything the compare dialog draws and the two reads it performs. */
export interface CompareDialogProps {
  /** Absolute path selected as the compare base. */
  readonly base: string
  /** Absolute path compared against it. */
  readonly target: string
  /** Namespace-bound translate. */
  readonly t: TranslateNS<'sidebarFiles'>
  /**
   * Read one file's compared page.
   * @param path - absolute path of the file.
   */
  readonly readPage: (path: string) => Promise<RemoteResult<FilePage>>
  /** Dismiss the dialog. */
  readonly onClose: () => void
}

/**
 * Render the comparison.
 * @param props - see {@link CompareDialogProps}.
 * @returns the dialog element.
 */
export function CompareDialog({ base, target, t, readPage, onClose }: CompareDialogProps): ReactNode {
  const [pages, setPages] = useState<{ base: FilePage; target: FilePage } | null>(null)
  const [failure, setFailure] = useState<RemoteFailure | null>(null)
  // Both sides are read once when the dialog opens (or the pair changes): a
  // side that settles first waits for the other before anything is drawn.
  useEffect(() => {
    let basePage: FilePage | undefined
    let targetPage: FilePage | undefined
    const settle = (): void => {
      if (basePage !== undefined && targetPage !== undefined) setPages({ base: basePage, target: targetPage })
    }
    setPages(null)
    setFailure(null)
    void readPage(base).then((result) => {
      if (!result.ok) { setFailure(result.error); return }
      basePage = result.value
      settle()
    })
    void readPage(target).then((result) => {
      if (!result.ok) { setFailure(result.error); return }
      targetPage = result.value
      settle()
    })
  }, [base, target, readPage])

  const labels: DiffBlockLabels = {
    copy: t('diff.copy'),
    copied: t('diff.copied'),
    collapse: t('diff.collapse'),
    expand: hidden => t('diff.expand', { hidden }),
    collapseAria: t('diff.collapseAria'),
    expandAria: hidden => t('diff.expandAria', { hidden }),
    files: count => t('diff.files', { count }),
  }
  return (
    <Modal
      open
      title={t('compare.title')}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      className={css.compareDialog ?? ''}
    >
      <div className={css.comparePaths} data-compare-paths>
        {t('compare.paths', { base, target })}
      </div>
      {failure !== null && (
        <p className={css.dialogError} role="alert" data-compare-failure>{actionFailureLine(t, failure)}</p>
      )}
      {failure === null && pages === null && (
        <p className={css.dialogNote} data-compare-loading>{t('loading')}</p>
      )}
      {pages !== null && (
        <>
          {(!pages.base.eof || !pages.target.eof) && (
            <p className={css.dialogNote} data-compare-truncated>{t('compare.truncated')}</p>
          )}
          <DiffBlock
            diffs={[{ path: target, oldText: pages.base.text, newText: pages.target.text }]}
            labels={labels}
          />
        </>
      )}
    </Modal>
  )
}
