import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'
import { useDraftPicks } from '../hooks/useDraftPicks'

export default function DraftPicksPage() {
  const { data, loading, error } = useDraftPicks()

  if (loading) return <LoadingState message="Loading draft picks..." />
  if (error) return <ErrorState message={error} />

  return (
    <div className="stack">
      <div className="card">
        <span className="eyebrow">Draft picks</span>
        <h2 className="page-title">Current and future draft capital</h2>
        <p className="lead">Backed by the Fantrax draft picks endpoint for the currently selected season.</p>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Season</th>
                <th>Round</th>
                <th>Overall</th>
                <th>Original Owner</th>
                <th>Current Owner</th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((pick) => (
                <tr key={pick.id}>
                  <td>{pick.season}</td>
                  <td>{pick.round}</td>
                  <td>{pick.overall}</td>
                  <td>{pick.originalOwner}</td>
                  <td>{pick.currentOwner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
