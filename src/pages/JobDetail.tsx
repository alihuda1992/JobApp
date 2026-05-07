import { useParams } from 'react-router-dom'

export function JobDetail() {
  const { id } = useParams()
  return (
    <div>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Job Detail</h1>
      <p style={{ color: 'rgba(242,240,234,0.45)', fontSize: 13 }}>
        Job ID: {id} — full detail view coming in Sprint 3.
      </p>
    </div>
  )
}
