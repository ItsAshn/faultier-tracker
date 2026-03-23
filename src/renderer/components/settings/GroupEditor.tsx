import { useState, useMemo, useCallback } from 'react'
import { Plus, Trash2, RefreshCw, Search, X } from 'lucide-react'
import Fuse from 'fuse.js'
import { useAppStore } from '../../store/appStore'
import type { AppRecord, AppGroup } from '@shared/types'
import ConfirmModal from '../ui/ConfirmModal'

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useState(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  })
  return debounced
}

export default function GroupEditor(): JSX.Element {
  const apps = useAppStore((s) => s.apps)
  const groups = useAppStore((s) => s.groups)
  const createGroup = useAppStore((s) => s.createGroup)
  const deleteGroup = useAppStore((s) => s.deleteGroup)
  const setAppGroup = useAppStore((s) => s.setAppGroup)
  const reanalyzeGroups = useAppStore((s) => s.reanalyzeGroups)

  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(groups[0]?.id ?? null)
  const [newGroupName, setNewGroupName] = useState('')
  const [reanalyzing, setReanalyzing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const debouncedSearch = useDebouncedValue(searchQuery, 300)

  const appsInGroup = useMemo(
    () => apps.filter((a) => a.group_id === selectedGroupId),
    [apps, selectedGroupId]
  )

  const appsNotInGroup = useMemo(
    () => apps.filter((a) => a.group_id !== selectedGroupId),
    [apps, selectedGroupId]
  )

  const fuse = useMemo(() => {
    return new Fuse(appsNotInGroup, {
      keys: ['display_name', 'exe_name'],
      threshold: 0.4,
      ignoreLocation: true,
    })
  }, [appsNotInGroup])

  const searchResults = useMemo(() => {
    if (!debouncedSearch.trim()) return []
    return fuse.search(debouncedSearch).slice(0, 20).map((r) => r.item)
  }, [fuse, debouncedSearch])

  const selectedGroup = groups.find((g) => g.id === selectedGroupId)

  const handleCreateGroup = useCallback(async () => {
    const name = newGroupName.trim()
    if (!name) return
    const group = await createGroup(name)
    setSelectedGroupId(group.id)
    setNewGroupName('')
  }, [newGroupName, createGroup])

  const handleDeleteGroup = useCallback(async (id: number) => {
    await deleteGroup(id)
    setSelectedGroupId(groups.find((g) => g.id !== id)?.id ?? null)
    setConfirmDeleteId(null)
  }, [deleteGroup, groups])

  const handleReanalyze = useCallback(async () => {
    setReanalyzing(true)
    await reanalyzeGroups()
    setReanalyzing(false)
  }, [reanalyzeGroups])

  const handleAddToGroup = useCallback(async (appId: number) => {
    await setAppGroup(appId, selectedGroupId)
    setSearchQuery('')
  }, [setAppGroup, selectedGroupId])

  const handleRemoveFromGroup = useCallback(async (appId: number) => {
    await setAppGroup(appId, null)
  }, [setAppGroup])

  const ungroupedApps = useMemo(() => apps.filter((a) => a.group_id === null), [apps])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          className="btn btn--ghost"
          onClick={handleReanalyze}
          disabled={reanalyzing}
          title="Re-run auto-grouping for all apps"
        >
          <RefreshCw size={14} className={reanalyzing ? 'spin' : ''} />
          Re-analyze groups
        </button>
      </div>

      <div className="group-editor">
        {/* Group list */}
        <div className="group-list">
          <div className="group-list__header">Groups</div>
          <div className="group-list__body">
            {groups.map((g) => (
              <button
                key={g.id}
                className={`group-list__item${selectedGroupId === g.id ? ' group-list__item--active' : ''}`}
                onClick={() => setSelectedGroupId(g.id)}
              >
                <span className="group-list__name">{g.name}</span>
                <span className="group-list__count">{apps.filter((a) => a.group_id === g.id).length}</span>
                <button
                  className="btn--icon"
                  style={{ marginLeft: 'auto', padding: 2 }}
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(g.id) }}
                >
                  <Trash2 size={13} />
                </button>
              </button>
            ))}

            <button
              className={`group-list__item${selectedGroupId === null ? ' group-list__item--active' : ''}`}
              onClick={() => setSelectedGroupId(null)}
            >
              <span className="group-list__name text-muted">Ungrouped</span>
              <span className="group-list__count">{ungroupedApps.length}</span>
            </button>
          </div>

          {/* New group input */}
          <div style={{ padding: 8, borderTop: '1px solid var(--color-border)', display: 'flex', gap: 4 }}>
            <input
              className="input"
              style={{ fontSize: 'var(--text-xs)', padding: '4px 8px' }}
              placeholder="New group name..."
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
            />
            <button className="btn--icon" onClick={handleCreateGroup} title="Create group">
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Apps in selected group */}
        <div className="group-apps-panel">
          <div className="group-apps-panel__header">
            {selectedGroup?.name ?? 'Ungrouped'} ({selectedGroupId !== null ? appsInGroup.length : ungroupedApps.length} apps)
          </div>

          {/* Search to add apps */}
          <div className="group-search">
            <div className="group-search__input-wrapper">
              <Search size={14} className="group-search__icon" />
              <input
                className="group-search__input"
                type="text"
                placeholder="Search apps to add..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="btn--icon group-search__clear" onClick={() => setSearchQuery('')}>
                  <X size={12} />
                </button>
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="group-search__results">
                {searchResults.map((app) => (
                  <div key={app.id} className="group-search__result">
                    <span className="group-search__result-name">{app.display_name}</span>
                    <span className="group-search__result-exe">{app.exe_name}</span>
                    <button
                      className="btn btn--sm"
                      onClick={() => handleAddToGroup(app.id)}
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Current members */}
          <div className="group-apps-panel__body">
            {(selectedGroupId !== null ? appsInGroup : ungroupedApps).length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-dim)', fontSize: 'var(--text-sm)' }}>
                No apps in this group. Use the search above to add apps.
              </div>
            )}
            {(selectedGroupId !== null ? appsInGroup : ungroupedApps).map((app) => (
              <div key={app.id} className="group-app-row">
                <span className="group-app-row__name">{app.display_name}</span>
                <span className="group-app-row__exe">{app.exe_name}</span>
                <button
                  className="btn--icon"
                  style={{ marginLeft: 'auto', padding: 2 }}
                  onClick={() => handleRemoveFromGroup(app.id)}
                  title="Remove from group"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmDeleteId !== null}
        title="Delete group"
        message="Delete this group? All apps in it will become ungrouped."
        confirmLabel="Delete"
        danger
        onConfirm={() => confirmDeleteId !== null && handleDeleteGroup(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}