import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useSeason } from "../context/SeasonContext"
import {
  decodeMaybeBrokenText,
  getTeamBySlugFromLeagueInfo,
  getTeamMatchups,
  buildPlayerLookupFromAdp,
  buildPlayerLookupFromCsvRows,
  mergePlayerLookups,
  parsePlayerCsv,
  getRosterForTeam,
  enrichRosterItems,
  slugifyTeamName,
} from "../utils/fantrax"

const playerCsvFiles = import.meta.glob("../config/playerCsv/*.csv", {
  query: "?raw",
  import: "default",
})

function formatScoreValue(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? "—")
  return n.toString()
}

function formatScoreText(scoreText) {
  const parts = String(scoreText || "").split("-").map((s) => s.trim())
  if (parts.length !== 2) return scoreText || "—"
  return `${formatScoreValue(parts[0])} - ${formatScoreValue(parts[1])}`
}

export default function TeamDetailPage() {
  const { teamSlug } = useParams()
  const { season } = useSeason()

  const [leagueInfo, setLeagueInfo] = useState(null)
  const [teamRosters, setTeamRosters] = useState(null)
  const [adpRows, setAdpRows] = useState([])
  const [playerCsvRows, setPlayerCsvRows] = useState([])
  const [matchupResults, setMatchupResults] = useState(null)
  const [period, setPeriod] = useState("1")
  const [activeTab, setActiveTab] = useState("results")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")


  
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        const matchupFile = `/data/matchup-results-${encodeURIComponent(season.key)}.json`

        const csvLoader = playerCsvFiles[`../config/playerCsv/${season.key}.csv`]

const [leagueRes, rosterRes, adpRes, matchupRes, csvText] = await Promise.all([
  fetch(`/api/league-info?season=${encodeURIComponent(season.key)}`),
  fetch(`/api/team-rosters?season=${encodeURIComponent(season.key)}&period=${encodeURIComponent(period)}`),
  fetch(`/api/adp`),
  fetch(matchupFile),
  csvLoader ? csvLoader() : Promise.resolve(""),
])

const [leagueText, rosterText, adpText, matchupText] = await Promise.all([
  leagueRes.text(),
  rosterRes.text(),
  adpRes.text(),
  matchupRes.text(),
])

        if (!leagueRes.ok) throw new Error(`League info failed (${leagueRes.status}): ${leagueText}`)
        if (!rosterRes.ok) throw new Error(`Team rosters failed (${rosterRes.status}): ${rosterText}`)
        if (!adpRes.ok) throw new Error(`ADP failed (${adpRes.status}): ${adpText}`)
        if (!matchupRes.ok) throw new Error(`Matchup results failed (${matchupRes.status}): ${matchupText}`)

        if (!cancelled) {
  setLeagueInfo(JSON.parse(leagueText))
  setTeamRosters(JSON.parse(rosterText))
  setAdpRows(JSON.parse(adpText))
  setPlayerCsvRows(parsePlayerCsv(csvText || ""))
  setMatchupResults(JSON.parse(matchupText))
}
      } catch (err) {
        if (!cancelled) {
  setError(err instanceof Error ? err.message : "Unknown error")
  setLeagueInfo(null)
  setTeamRosters(null)
  setAdpRows([])
  setPlayerCsvRows([])
  setMatchupResults(null)
}
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [season.key, period])

  const team = useMemo(
  () => getTeamBySlugFromLeagueInfo(leagueInfo, teamSlug),
  [leagueInfo, teamSlug]
)

const teamId = team?.id || ""

  const playerLookup = useMemo(() => {
  const csvLookup = buildPlayerLookupFromCsvRows(playerCsvRows)
  const adpLookup = buildPlayerLookupFromAdp(adpRows)

  return mergePlayerLookups(csvLookup, adpLookup)
}, [playerCsvRows, adpRows])

  const rosterItems = useMemo(() => {
    const raw = getRosterForTeam(teamRosters, teamId)
    return enrichRosterItems(raw, playerLookup)
  }, [teamRosters, teamId, playerLookup])

  const sortRosterByAdp = (rows) =>
    [...rows].sort((a, b) => {
      const aAdp = typeof a?.playerAdp === "number" ? a.playerAdp : Number.POSITIVE_INFINITY
      const bAdp = typeof b?.playerAdp === "number" ? b.playerAdp : Number.POSITIVE_INFINITY
      if (aAdp !== bAdp) return aAdp - bAdp
      return String(a?.playerName || "").localeCompare(String(b?.playerName || ""))
    })

  const active = useMemo(
    () => sortRosterByAdp(rosterItems.filter((p) => p.status === "ACTIVE")),
    [rosterItems]
  )

  const reserve = useMemo(
    () => sortRosterByAdp(rosterItems.filter((p) => p.status === "RESERVE")),
    [rosterItems]
  )

  const ir = useMemo(
    () => sortRosterByAdp(rosterItems.filter((p) => p.status === "INJURED_RESERVE")),
    [rosterItems]
  )

  const matchups = useMemo(
    () => getTeamMatchups(leagueInfo, teamId),
    [leagueInfo, teamId]
  )

  const matchupRows = useMemo(() => {
    const rows = []

    for (const matchup of matchupResults?.matchups || []) {
      const teams = Array.isArray(matchup?.teams) ? matchup.teams : []
      const mine = teams.find((t) => String(t?.id) === String(teamId))
      if (!mine) continue

      const opponent = teams.find((t) => String(t?.id) !== String(teamId)) || null
      const isWinner = String(matchup?.winnerTeamId || "") === String(teamId)

      rows.push({
        period: matchup.period,
        matchupId: matchup.matchupId,
        opponentId: opponent?.id || "",
        opponentName: decodeMaybeBrokenText(opponent?.name || "—"),
        result:
          matchup?.winnerTeamId == null
            ? "T"
            : isWinner
            ? "W"
            : "L",
        score: formatScoreText(matchup?.scoreText),
      })
    }

    return rows.sort((a, b) => a.period - b.period)
  }, [matchupResults, teamId])

  const completedPeriods = useMemo(
    () => new Set(matchupRows.map((row) => Number(row.period))),
    [matchupRows]
  )

  const upcomingScheduleRows = useMemo(() => {
    return matchups.filter((row) => !completedPeriods.has(Number(row.period)))
  }, [matchups, completedPeriods])

  if (loading) return <main style={main}><div>Loading team profile...</div></main>
  if (error) return <main style={main}><div style={errorBox}>{error}</div></main>
  if (!team) return <main style={main}><div style={errorBox}>Team not found for this season.</div></main>

  return (
    <main style={main}>
      <Link to="/teams" style={backLink}>← Back to teams</Link>

      <div style={card}>
        <div style={eyebrow}>Team Profile</div>
        <h1 style={{ margin: "0 0 10px" }}>{decodeMaybeBrokenText(team.name)}</h1>
        <div style={{ color: "#6b7280" }}>Season: {season.label}</div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Roster</h3>
          <label>
            Period{" "}
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {Array.from({ length: 22 }, (_, i) => String(i + 1)).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div style={rosterGrid}>
        <RosterSection title="Active" rows={active} />
        <RosterSection title="Reserve" rows={reserve} />
        <RosterSection title="Injured Reserve" rows={ir} />
      </div>

      <div style={card}>
        <div style={tabRow}>
          <button
            type="button"
            onClick={() => setActiveTab("results")}
            style={activeTab === "results" ? activeTabBtn : tabBtn}
          >
            Matchup Results
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("schedule")}
            style={activeTab === "schedule" ? activeTabBtn : tabBtn}
          >
            Schedule
          </button>
        </div>

        {activeTab === "results" ? (
          <>
            <h3 style={sectionTitle}>Matchup Results</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#fff7ed" }}>
                    <th style={th}>Period</th>
                    <th style={th}>Opponent</th>
                    <th style={th}>Result</th>
                    <th style={th}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {matchupRows.map((row) => (
                    <tr key={`${row.period}-${row.matchupId}-${row.opponentId}`}>
                      <td style={td}>{row.period}</td>
                      <td style={td}>
                        {row.opponentId ? (
                          <Link to={`/teams/${slugifyTeamName(row.opponentName)}`} style={teamLink}>
  {row.opponentName}
</Link>
                        ) : (
                          row.opponentName
                        )}
                      </td>
                      <td style={{ ...td, fontWeight: 700, color: row.result === "W" ? "#15803d" : row.result === "L" ? "#b91c1c" : "#92400e" }}>
                        {row.result}
                      </td>
                      <td style={td}>{row.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <h3 style={sectionTitle}>Schedule</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#fff7ed" }}>
                    <th style={th}>Period</th>
                    <th style={th}>Venue</th>
                    <th style={th}>Opponent</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingScheduleRows.map((row) => (
                    <tr key={`${row.period}-${row.venue}-${row.opponentId}`}>
                      <td style={td}>{row.period}</td>
                      <td style={td}>{row.venue}</td>
                      <td style={td}>
                        {row.opponentId ? (
                          <Link to={`/teams/${slugifyTeamName(row.opponentName)}`} style={teamLink}>
                          {row.opponentName}
                        </Link>
                        ) : (
                          row.opponentName
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

function RosterSection({ title, rows }) {
  return (
    <div style={rosterCard}>
      <h3 style={sectionTitle}>{title}</h3>
      {rows.length === 0 ? (
        <div>No players.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fff7ed" }}>
                <th style={th}>Player</th>
                <th style={th}>Pos</th>
                <th style={th}>Slot</th>
                <th style={th}>ADP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.id}-${row.position}-${row.status}`}>
                  <td style={td}>{row.playerName}</td>
                  <td style={td}>{row.playerPos || "—"}</td>
                  <td style={td}>{row.position || "—"}</td>
                  <td style={td}>
                    {typeof row.playerAdp === "number" ? row.playerAdp.toFixed(2) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const main = {
  maxWidth: 1200,
  margin: "0 auto",
  padding: "32px 20px",
}

const card = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 24,
  marginBottom: 20,
}

const rosterCard = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 20,
  minWidth: 0,
}

const rosterGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 16,
  marginBottom: 20,
}

const tabRow = {
  display: "flex",
  gap: 10,
  marginBottom: 16,
  flexWrap: "wrap",
}

const tabBtn = {
  border: "1px solid #fed7aa",
  background: "#fff7ed",
  color: "#9a3412",
  borderRadius: 999,
  padding: "10px 14px",
  fontWeight: 700,
  cursor: "pointer",
}

const activeTabBtn = {
  ...tabBtn,
  background: "#f97316",
  color: "#ffffff",
  border: "1px solid #f97316",
}

const eyebrow = {
  color: "#f97316",
  fontWeight: 700,
  marginBottom: 8,
}

const sectionTitle = {
  marginTop: 0,
  marginBottom: 16,
}

const errorBox = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 24,
  color: "#9a3412",
}

const backLink = {
  display: "inline-block",
  marginBottom: 16,
  color: "#f97316",
  textDecoration: "none",
  fontWeight: 600,
}

const th = {
  textAlign: "left",
  padding: "14px 16px",
  borderBottom: "1px solid #fed7aa",
  color: "#9a3412",
}

const td = {
  padding: "14px 16px",
  borderBottom: "1px solid #ffedd5",
}

const teamLink = {
  color: "#9a3412",
  textDecoration: "none",
  fontWeight: 600,
}