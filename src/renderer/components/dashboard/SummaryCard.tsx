import type { ReactNode } from 'react'

interface Props {
  label: string
  value: string
  sub?: string
  icon: ReactNode
}

export default function SummaryCard({ label, value, sub, icon }: Props): JSX.Element {
  return (
    <div className="summary-card">
      <div className="summary-card__icon">{icon}</div>
      <div className="summary-card__label">{label}</div>
      <div className="summary-card__value">{value}</div>
      {sub && <div className="summary-card__sub">{sub}</div>}
    </div>
  )
}
