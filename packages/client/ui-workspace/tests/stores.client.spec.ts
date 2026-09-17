// @vitest-environment jsdom
/**
 * Persisted workspace viewing store: pinned Sessions are client-side view
 * facts that survive a reload through the same `dsh.workspace.view.v5`
 * payload as the saved manual orders, and a payload written before pinning
 * existed reads as nothing pinned.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkspaceViewStore, pinnedSessionIdsOf } from '../src/client/stores.ts'

const PERSIST_KEY = 'dsh.workspace.view.v5'

beforeEach(() => { localStorage.clear() })
afterEach(() => { localStorage.clear() })

describe('pinned Session ids', () => {
  it('leads with the most recent pin and keeps one slot per Session', () => {
    const instance = createWorkspaceViewStore().create()
    expect(pinnedSessionIdsOf(instance.getSnapshot())).toEqual([])

    instance.actions.setPinned('a', true)
    instance.actions.setPinned('b', true)
    expect(pinnedSessionIdsOf(instance.getSnapshot())).toEqual(['b', 'a'])

    // Re-pinning refreshes the position instead of duplicating the slot.
    instance.actions.setPinned('a', true)
    expect(pinnedSessionIdsOf(instance.getSnapshot())).toEqual(['a', 'b'])

    instance.actions.setPinned('a', false)
    expect(pinnedSessionIdsOf(instance.getSnapshot())).toEqual(['b'])

    // Unpinning an id that was never pinned leaves the set untouched.
    instance.actions.setPinned('ghost', false)
    expect(pinnedSessionIdsOf(instance.getSnapshot())).toEqual(['b'])
  })

  it('round-trips pins and the saved manual order through the persist key', () => {
    const first = createWorkspaceViewStore().create()
    first.actions.setSessionOrder('alpha', ['one', 'two'], {})
    first.actions.setPinned('one', true)
    first.actions.setPinned('two', true)

    const reloaded = createWorkspaceViewStore().create()
    expect(pinnedSessionIdsOf(reloaded.getSnapshot())).toEqual(['two', 'one'])
    expect(reloaded.getSnapshot().sessionOrderByAccount.alpha).toEqual(['one', 'two'])
    expect(reloaded.getSnapshot().orderBy).toBe('manual')
  })

  it('reads a payload written before pinning existed as nothing pinned', () => {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      groupBy: 'workspace',
      orderBy: 'manual',
      groupExpansion: { alpha: true },
      sessionOrderByAccount: { alpha: ['one'] },
    }))
    const legacy = createWorkspaceViewStore().create()
    expect(pinnedSessionIdsOf(legacy.getSnapshot())).toEqual([])
    // The fields the payload does carry survive untouched.
    expect(legacy.getSnapshot().groupExpansion).toEqual({ alpha: true })

    legacy.actions.setPinned('one', true)
    expect(pinnedSessionIdsOf(legacy.getSnapshot())).toEqual(['one'])
    expect(JSON.parse(localStorage.getItem(PERSIST_KEY) ?? '{}'))
      .toMatchObject({ pinnedSessionIds: ['one'], groupExpansion: { alpha: true } })
  })
})
