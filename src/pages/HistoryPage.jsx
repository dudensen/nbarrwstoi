import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'
import { useSpreadsheetData } from '../hooks/useSpreadsheetData'

export default function HistoryPage() {
  const { data, loading, error } = useSpreadsheetData('history')

  if (loading) return <LoadingState message="Loading history from spreadsheet..." />
  if (error) return <ErrorState message={error} />

  const rows = data?.rows || []
  const headers = data?.headers || []

  return (
    <div className="stack">
      <div className="card">
        <span className="eyebrow">History</span>
        <h2 className="page-title">Spreadsheet-driven history</h2>
        <p className="lead">
          This page is intentionally generic so you can connect any public CSV sheet and start rendering old seasons,
          champions, award tables, or league records.
        </p>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">No spreadsheet rows found yet. Add your public sheet ID and GID in the season config.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {headers.map((header) => (
                      <td key={`${rowIndex}-${header}`}>{row[header] ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
