import type { AppRecord } from '@shared/types'
import { useAppStore } from '../../store/appStore'
import { getIconUrl } from '../../utils/iconUrl'

interface Props {
  app: AppRecord
}

export default function AppFilterRow({ app }: Props): JSX.Element {
  const setAppTracked = useAppStore((s) => s.setAppTracked)
  const iconUrl = getIconUrl('app', app.id)

  return (
    <div className="filter-row">
      <img className="filter-row__icon" src={iconUrl} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
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
