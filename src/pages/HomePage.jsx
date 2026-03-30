import StatCard from '../components/StatCard'
import LoadingState from '../components/LoadingState'
import ErrorState from '../components/ErrorState'
import { useLeagueInfo } from '../hooks/useLeagueInfo'
import { useStandings } from '../hooks/useStandings'
import { useSeason } from '../hooks/useSeason'
import { normalizeTeams } from '../utils/fantrax'

export default function HomePage() {
  const { season } = useSeason()
  const leagueInfo = useLeagueInfo()
  const standings = useStandings()

  if (leagueInfo.loading || standings.loading) return <LoadingState message="Loading league dashboard..." />
  if (leagueInfo.error) return <ErrorState message={leagueInfo.error} />
  if (standings.error) return <ErrorState message={standings.error} />

  const teams = normalizeTeams(leagueInfo.data)
  const leader = standings.data?.[0]

  return (
    <div className="stack">
      <section className="hero">
        <div className="card">
          <span className="eyebrow">Season {season.label}</span>
          <h2 className="page-title">Fantrax-powered league hub</h2>
          <p className="lead">
            This starter combines live Fantrax endpoints with spreadsheet-driven history.
            Swap season IDs in one file, and the whole site follows that selected season.
          </p>
          <div className="kpi-row" style={{ marginTop: 16 }}>
            <div className="kpi">League ID: {season.leagueId}</div>
            <div className="kpi">Teams detected: {teams.length || 0}</div>
            <div className="kpi">Current leader: {leader?.teamName || '—'}</div>
          </div>
        </div>

        <div className="grid cols-1">
          <StatCard label="Teams" value={teams.length || 0} note="From getLeagueInfo" />
          <StatCard label="Leader" value={leader?.teamName || '—'} note={`Record: ${leader?.record || '—'}`} />
        </div>
      </section>

      <section className="grid cols-3">
        <StatCard label="First Place Points" value={leader?.points || '—'} />
        <StatCard label="First Place GB" value={leader?.gamesBack || '0'} />
        <StatCard label="Season Key" value={season.key} />
      </section>

      <section className="card soft">
        <h2 className="section-title">Suggested next additions</h2>
        <p className="footer-note">
          Add logos, matchup views, player pages, transactions, charts, playoff brackets, and any custom spreadsheet
          blocks you already maintain publicly in Google Sheets.
        </p>
      </section>
    </div>
  )
}
