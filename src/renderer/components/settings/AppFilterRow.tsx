import { useEffect, useState } from 'react'
import type { AppRecord } from '@shared/types'
import { api } from '../../api/bridge'
import { useAppStore } from '../../store/appStore'

interface Props {
  app: AppRecord
}

export default function AppFilterRow({ app }: Props): JSX.Element {
  const setAppTracked = useAppStore((s) => s.setAppTracked)
  const [iconSrc, setIconSrc] = useState<string | null>(null)

  useEffect(() => {
    api.getIconForApp(app.id).then(setIconSrc)
  }, [app.id])

  return (
    <div className="filter-row">
      {iconSrc
        ? <img className="filter-row__icon" src={iconSrc} alt="" />
        : <div className="filter-row__icon-placeholder" />
      }
      <div className="filter-row__info">
        <div className="filter-row__name">{app.display_name}</div>
        {app.exe_path && (
          <div className="filter-row__path">{app.exe_path}</div>
        )}
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          className="toggle__input"
          checked={app.is_tracked}
          onChange={(e) => setAppTracked(app.id, e.target.checked)}
        />
        <span className="toggle__track" />
        <span className="toggle__thumb" />
      </label>
    </div>
  )
}
