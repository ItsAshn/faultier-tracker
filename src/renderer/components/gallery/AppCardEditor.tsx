import { useState, useEffect, KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { AppRecord, AppGroup } from '@shared/types'
import { useAppStore } from '../../store/appStore'
import ImageUploader from './ImageUploader'
import { api } from '../../api/bridge'

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
  const [description, setDescription] = useState(item.description)
  const [tags, setTags] = useState<string[]>(item.tags)
  const [tagInput, setTagInput] = useState('')
  const [iconSrc, setIconSrc] = useState<string | null>(item.custom_image_path)

  useEffect(() => {
    if (!item.custom_image_path) {
      if (isGroup) {
        api.getIconForGroup(item.id).then(setIconSrc)
      } else {
        api.getIconForApp(item.id).then(setIconSrc)
      }
    }
  }, [item.id])

  function addTag(): void {
    const t = tagInput.trim().toLowerCase()
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t])
    setTagInput('')
  }

  function handleTagKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && !tagInput) {
      setTags((prev) => prev.slice(0, -1))
    }
  }

  async function handleSave(): Promise<void> {
    if (isGroup) {
      await updateGroup({ id: item.id, name: displayName, description, tags })
    } else {
      await updateApp({ id: item.id, display_name: displayName, description, tags })
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
          currentSrc={iconSrc}
          onUpdated={(url) => setIconSrc(url)}
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

        <div className="field">
          <label className="field__label">Description</label>
          <textarea
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description..."
            rows={3}
            style={{ resize: 'vertical' }}
          />
        </div>

        <div className="field">
          <label className="field__label">Tags (press Enter or comma to add)</label>
          <div
            className="tags-input"
            onClick={() => document.getElementById('tag-field')?.focus()}
          >
            {tags.map((tag) => (
              <span key={tag} className="tags-input__tag">
                {tag}
                <button
                  className="tags-input__tag-remove"
                  onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              id="tag-field"
              className="tags-input__field"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKey}
              onBlur={addTag}
              placeholder={tags.length === 0 ? 'Add tags...' : ''}
            />
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
