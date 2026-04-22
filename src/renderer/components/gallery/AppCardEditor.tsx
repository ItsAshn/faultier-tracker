import { useState } from 'react'
import { Upload, Link, X, Loader, Globe } from 'lucide-react'
import type { AppRecord, AppGroup } from '@shared/types'
import { useAppStore } from '../../store/appStore'
import ImageUploader from './ImageUploader'
import ArtworkSearchModal from './ArtworkSearchModal'
import { getIconUrl } from '../../utils/iconUrl'

interface Props {
  item: AppRecord | AppGroup
  isGroup: boolean
  onClose: () => void
}

export default function AppCardEditor({ item, isGroup, onClose }: Props): JSX.Element {
  const updateApp = useAppStore((s) => s.updateApp)
  const updateGroup = useAppStore((s) => s.updateGroup)

  const [displayName, setDisplayName] = useState(
    isGroup ? (item as AppGroup).name : (item as AppRecord).display_name
  )
  const iconUrl = getIconUrl(isGroup ? 'group' : 'app', item.id)
  const [iconError, setIconError] = useState(false)
  const [artworkModalOpen, setArtworkModalOpen] = useState(false)

  async function handleSave(): Promise<void> {
    if (isGroup) {
      await updateGroup({ id: item.id, name: displayName })
    } else {
      await updateApp({ id: item.id, display_name: displayName })
    }
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">Edit {isGroup ? 'Group' : 'App'}</h2>
          <button className="btn--icon" onClick={onClose}><X size={18} /></button>
        </div>

        <ImageUploader
          id={item.id}
          isGroup={isGroup}
          currentSrc={iconError ? null : iconUrl}
          onUpdated={() => {}}
          onSearchOnline={() => setArtworkModalOpen(true)}
        />

        <div className="field">
          <label className="field__label">Display Name</label>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="App name"
          />
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave}>Save</button>
        </div>
      </div>

      {artworkModalOpen && (
        <ArtworkSearchModal
          appId={item.id}
          displayName={isGroup ? (item as AppGroup).name : (item as AppRecord).display_name}
          isGroup={isGroup}
          onClose={() => setArtworkModalOpen(false)}
          onApply={() => setArtworkModalOpen(false)}
        />
      )}
    </div>
  )
}