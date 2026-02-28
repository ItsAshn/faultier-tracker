import { useState } from 'react'
import { Plus, Trash2, RefreshCw } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import type { AppRecord, AppGroup } from '@shared/types'

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
  const [draggingAppId, setDraggingAppId] = useState<number | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<number | 'ungrouped' | null>(null)

  const appsInGroup = (gid: number | null): AppRecord[] =>
    apps.filter((a) => a.group_id === gid)

  async function handleCreateGroup(): Promise<void> {
    const name = newGroupName.trim()
    if (!name) return
    const group = await createGroup(name)
    setSelectedGroupId(group.id)
    setNewGroupName('')
  }

  async function handleDeleteGroup(id: number): Promise<void> {
    if (!window.confirm('Delete this group? Apps will become ungrouped.')) return
    await deleteGroup(id)
    setSelectedGroupId(groups.find((g) => g.id !== id)?.id ?? null)
  }

  async function handleReanalyze(): Promise<void> {
    setReanalyzing(true)
    await reanalyzeGroups()
    setReanalyzing(false)
  }

  function handleDragStart(appId: number): void {
    setDraggingAppId(appId)
  }

  function handleDrop(targetGroupId: number | null): void {
    if (draggingAppId === null) return
    setAppGroup(draggingAppId, targetGroupId)
    setDraggingAppId(null)
    setDragOverGroupId(null)
  }

  const selectedGroup = groups.find((g) => g.id === selectedGroupId)
  const groupApps = selectedGroupId !== null ? appsInGroup(selectedGroupId) : []
  const ungroupedApps = appsInGroup(null)

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
          <div className="group-list__header">
            Groups
          </div>
          <div className="group-list__body">
            {groups.map((g) => (
              <button
                key={g.id}
                className={`group-list__item${selectedGroupId === g.id ? ' group-list__item--active' : ''}${dragOverGroupId === g.id ? ' group-app-row--drag-over' : ''}`}
                onClick={() => setSelectedGroupId(g.id)}
                onDragOver={(e) => { e.preventDefault(); setDragOverGroupId(g.id) }}
                onDragLeave={() => setDragOverGroupId(null)}
                onDrop={() => handleDrop(g.id)}
              >
                <span className="group-list__name">{g.name}</span>
                <span className="group-list__count">{appsInGroup(g.id).length}</span>
                <button
                  className="btn--icon"
                  style={{ marginLeft: 'auto', padding: 2 }}
                  onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g.id) }}
                >
                  <Trash2 size={13} />
                </button>
              </button>
            ))}

            <button
              className={`group-list__item${selectedGroupId === null ? ' group-list__item--active' : ''}${dragOverGroupId === 'ungrouped' ? ' group-app-row--drag-over' : ''}`}
              onClick={() => setSelectedGroupId(null)}
              onDragOver={(e) => { e.preventDefault(); setDragOverGroupId('ungrouped') }}
              onDragLeave={() => setDragOverGroupId(null)}
              onDrop={() => handleDrop(null)}
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
            {selectedGroup?.name ?? 'Ungrouped'} — drag apps to reassign
          </div>
          <div className="group-apps-panel__body">
            {(selectedGroupId !== null ? groupApps : ungroupedApps).map((app) => (
              <div
                key={app.id}
                className="group-app-row"
                draggable
                onDragStart={() => handleDragStart(app.id)}
                onDragEnd={() => setDraggingAppId(null)}
              >
                <span
                  style={{ cursor: 'grab', color: 'var(--color-text-dim)', marginRight: 4 }}
                  title="Drag to move"
                >
                  ⠿
                </span>
                <span style={{ fontSize: 'var(--text-sm)', flex: 1 }}>{app.display_name}</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-dim)', fontFamily: 'var(--font-mono)' }}>
                  {app.exe_name}
                </span>
              </div>
            ))}
            {(selectedGroupId !== null ? groupApps : ungroupedApps).length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-dim)', fontSize: 'var(--text-sm)' }}>
                No apps here. Drag apps from other groups.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
