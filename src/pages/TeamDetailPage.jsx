import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useSeason } from "../context/SeasonContext"
import {
  decodeMaybeBrokenText,
  getTeamByIdFromLeagueInfo,
  getTeamMatchups,
  buildPlayerLookupFromAdp,
  getRosterForTeam,
  enrichRosterItems,
} from "../utils/fantrax"

export default function TeamDetailPage() {
  const { teamId } = useParams()
  const { season } = useSeason()

  const [leagueInfo, setLeagueInfo] = useState(null)
  const [teamRosters, setTeamRosters] = useState(null)
  const [adpRows, setAdpRows] = useState([])
  const [period, setPeriod] = useState("1")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        const [leagueRes, rosterRes, adpRes] = await Promise.all([
          fetch(`/api/league-info?season=${encodeURIComponent(season.key)}`),
          fetch(`/api/team-rosters?season=${encodeURIComponent(season.key)}&period=${encodeURIComponent(period)}`),
          fetch(`/api/adp`),
        ])

        const [leagueText, rosterText, adpText] = await Promise.all([
          leagueRes.text(),
          rosterRes.text(),
          adpRes.text(),
        ])

        if (!leagueRes.ok) throw new Error(`League info failed (${leagueRes.status}): ${leagueText}`)
        if (!rosterRes.ok) throw new Error(`Team rosters failed (${rosterRes.status}): ${rosterText}`)
        if (!adpRes.ok) throw new Error(`ADP failed (${adpRes.status}): ${adpText}`)

        if (!cancelled) {
          setLeagueInfo(JSON.parse(leagueText))
          setTeamRosters(JSON.parse(rosterText))
          setAdpRows(JSON.parse(adpText))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setLeagueInfo(null)
          setTeamRosters(null)
          setAdpRows([])
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
    () => getTeamByIdFromLeagueInfo(leagueInfo, teamId),
    [leagueInfo, teamId]
  )

  const playerLookup = useMemo(
    () => buildPlayerLookupFromAdp(adpRows),
    [adpRows]
  )

  const rosterItems = useMemo(() => {
    const raw = getRosterForTeam(teamRosters, teamId)
    return enrichRosterItems(raw, playerLookup)
  }, [teamRosters, teamId, playerLookup])

  const matchups = useMemo(
    () => getTeamMatchups(leagueInfo, teamId),
    [leagueInfo, teamId]
  )

  if (loading) return <main style={main}><div>Loading team profile...</div></main>
  if (error) return <main style={main}><div style={errorBox}>{error}</div></main>
  if (!team) return <main style={main}><div style={errorBox}>Team not found for this season.</div></main>

  const active = rosterItems.filter((p) => p.status === "ACTIVE")
  const reserve = rosterItems.filter((p) => p.status === "RESERVE")
  const ir = rosterItems.filter((p) => p.status === "INJURED_RESERVE")

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

      <RosterSection title="Active" rows={active} />
      <RosterSection title="Reserve" rows={reserve} />
      <RosterSection title="Injured Reserve" rows={ir} />

      <div style={card}>
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
              {matchups.map((row) => (
                <tr key={`${row.period}-${row.venue}-${row.opponentId}`}>
                  <td style={td}>{row.period}</td>
                  <td style={td}>{row.venue}</td>
                  <td style={td}>{row.opponentName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}

function RosterSection({ title, rows }) {
  return (
    <div style={card}>
      <h3 style={sectionTitle}>{title}</h3>
      {rows.length === 0 ? (
        <div>No players.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fff7ed" }}>
                <th style={th}>Player</th>
                <th style={th}>ADP Pos</th>
                <th style={th}>Slot</th>
                <th style={th}>Status</th>
                <th style={th}>ADP</th>
                <th style={th}>ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.id}-${row.position}-${row.status}`}>
                  <td style={td}>{row.playerName}</td>
                  <td style={td}>{row.playerPos || "—"}</td>
                  <td style={td}>{row.position || "—"}</td>
                  <td style={td}>{row.status || "—"}</td>
                  <td style={td}>
                    {typeof row.playerAdp === "number" ? row.playerAdp.toFixed(2) : "—"}
                  </td>
                  <td style={td}>{row.id}</td>
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