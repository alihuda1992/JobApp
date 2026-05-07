import { useParams } from 'react-router-dom'

export function CoverLetter() {
  const { jobId } = useParams()
  return (
    <div>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Cover Letter</h1>
      <p style={{ color: 'rgba(242,240,234,0.45)', fontSize: 13 }}>
        AI cover letter generator for job {jobId} — coming in Sprint 5.
      </p>
    </div>
  )
}
