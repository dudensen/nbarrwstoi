import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useSeason } from "../context/SeasonContext"
import {
  decodeMaybeBrokenText,
  extractTeamsFromLeagueInfo,
  slugifyTeamName,
} from "../utils/fantrax"

function s(value) {
  return String(value ?? "").trim()
}

function normalizeName(value) {
  return s(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
}

function toNumberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function compareValues(a, b) {
  const aNum = toNumberOrNull(a)
  const bNum = toNumberOrNull(b)

  if (aNum != null && bNum != null) return aNum - bNum
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

function getTeamIdFromStandingsRow(row) {
  return (
    row?.teamId ||
    row?.id ||
    row?.franchiseId ||
    row?.team?.id ||
    ""
  )
}

function getTeamNameFromStandingsRow(row) {
  return decodeMaybeBrokenText(
    row?.teamName ||
      row?.name ||
      row?.team ||
      row?.franchiseName ||
      row?.team?.name ||
      ""
  )
}

function getDisplayColumns(rows) {
  const preferred = [
    { key: "rank", label: "#" },
    { key: "teamName", label: "Team" },
    { key: "record", label: "Record" },
    { key: "points", label: "Points" },
    { key: "percentage", label: "%" },
    { key: "gamesBack", label: "GB" },
    { key: "streak", label: "Streak" },
  ]

  const first = rows?.[0] || {}

  return preferred.filter((col) => {
    if (col.key === "teamName") return true
    return Object.prototype.hasOwnProperty.call(first, col.key)
  })
}

function buildTeamMetaMap(leagueInfo) {
  const teams = extractTeamsFromLeagueInfo(leagueInfo)
  const byId = new Map()
  const byName = new Map()

  for (const team of teams) {
    const decodedName = decodeMaybeBrokenText(team?.name || "")
    const slug = slugifyTeamName(decodedName)

    byId.set(String(team.id), {
      id: String(team.id),
      name: decodedName,
      slug,
    })

    byName.set(normalizeName(decodedName), {
      id: String(team.id),
      name: decodedName,
      slug,
    })
  }

  return { byId, byName }
}

function buildFormMap(matchupResults) {
  const byTeamId = new Map()

  for (const matchup of matchupResults?.matchups || []) {
    const teams = Array.isArray(matchup?.teams) ? matchup.teams : []
    if (teams.length < 2) continue

    const winnerTeamId = matchup?.winnerTeamId == null ? null : String(matchup.winnerTeamId)
    const period = Number(matchup?.period)

    for (const team of teams) {
      const teamId = String(team?.id || "")
      if (!teamId) continue

      let result = "T"
      if (winnerTeamId != null) {
        result = winnerTeamId === teamId ? "W" : "L"
      }

      if (!byTeamId.has(teamId)) byTeamId.set(teamId, [])
      byTeamId.get(teamId).push({ period, result })
    }
  }

  for (const [teamId, items] of byTeamId.entries()) {
    items.sort((a, b) => a.period - b.period)
    byTeamId.set(teamId, items.slice(-5))
  }

  return byTeamId
}

function FormCell({ results }) {
  if (!results?.length) {
    return <span style={{ color: "#9ca3af" }}>—</span>
  }

  return (
    <div style={formRow}>
      {results.map((item, idx) => {
        const style =
          item.result === "W"
            ? formWin
            : item.result === "L"
            ? formLoss
            : formTie

        return (
          <span
            key={`${item.period}-${item.result}-${idx}`}
            style={style}
            title={`Period ${item.period}: ${item.result}`}
          >
            {item.result}
          </span>
        )
      })}
    </div>
  )
}

export default function StandingsPage() {
  const { season } = useSeason()

  const [rows, setRows] = useState([])
  const [leagueInfo, setLeagueInfo] = useState(null)
  const [matchupResults, setMatchupResults] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        const matchupFile = `/data/matchup-results-${encodeURIComponent(season.key)}.json`

        const [standingsRes, leagueRes, matchupRes] = await Promise.allSettled([
          fetch(`/api/standings?season=${encodeURIComponent(season.key)}`),
          fetch(`/api/league-info?season=${encodeURIComponent(season.key)}`),
          fetch(matchupFile),
        ])

        let nextRows = []
        let nextLeagueInfo = null
        let nextMatchupResults = null

        if (standingsRes.status !== "fulfilled") {
          throw new Error("Failed to reach standings endpoint.")
        }

        const standingsText = await standingsRes.value.text()
        if (!standingsRes.value.ok) {
          throw new Error(`Request failed (${standingsRes.value.status}): ${standingsText}`)
        }
        nextRows = Array.isArray(JSON.parse(standingsText)) ? JSON.parse(standingsText) : []

        if (leagueRes.status === "fulfilled") {
          const leagueText = await leagueRes.value.text()
          if (leagueRes.value.ok) {
            nextLeagueInfo = JSON.parse(leagueText)
          }
        }

        if (matchupRes.status === "fulfilled") {
          const matchupText = await matchupRes.value.text()
          if (matchupRes.value.ok) {
            nextMatchupResults = JSON.parse(matchupText)
          }
        }

        if (!cancelled) {
          setRows(nextRows)
          setLeagueInfo(nextLeagueInfo)
          setMatchupResults(nextMatchupResults)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setRows([])
          setLeagueInfo(null)
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
  }, [season.key])

  const columns = useMemo(() => getDisplayColumns(rows), [rows])
  const teamMeta = useMemo(() => buildTeamMetaMap(leagueInfo), [leagueInfo])
  const formMap = useMemo(() => buildFormMap(matchupResults), [matchupResults])

  const enrichedRows = useMemo(() => {
    return rows.map((row, index) => {
      const rowTeamId = String(getTeamIdFromStandingsRow(row))
      const rowTeamName = getTeamNameFromStandingsRow(row)

      const teamFromId = rowTeamId ? teamMeta.byId.get(rowTeamId) : null
      const teamFromName = rowTeamName ? teamMeta.byName.get(normalizeName(rowTeamName)) : null
      const resolvedTeam = teamFromId || teamFromName || null
      const resolvedTeamId = resolvedTeam?.id || rowTeamId || ""
      const form = resolvedTeamId ? formMap.get(resolvedTeamId) || [] : []

      return {
        ...row,
        __rowKey: `${resolvedTeamId || rowTeamName || "team"}-${index}`,
        __teamName: resolvedTeam?.name || rowTeamName || "—",
        __teamSlug: resolvedTeam?.slug || (rowTeamName ? slugifyTeamName(rowTeamName) : ""),
        __form: form,
      }
    })
  }, [rows, teamMeta, formMap])

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #fed7aa",
          borderRadius: 20,
          padding: 24,
          marginBottom: 20,
        }}
      >
        <div style={{ color: "#f97316", fontWeight: 700, marginBottom: 8 }}>
          Standings
        </div>
        <h2 style={{ margin: 0 }}>{season.label} standings</h2>
        <p style={{ color: "#6b7280", marginTop: 10 }}>
          This page reads the selected season and hits the matching Fantrax league automatically.
        </p>
      </div>

      {loading ? (
        <div style={{ padding: 16 }}>Loading standings...</div>
      ) : error ? (
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 20,
            padding: 24,
            color: "#9a3412",
          }}
        >
          {error}
        </div>
      ) : (
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #fed7aa",
            borderRadius: 20,
            padding: 20,
            overflowX: "auto",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fff7ed" }}>
                {columns.map((col) => (
                  <th key={col.key} style={th}>
                    {col.label}
                  </th>
                ))}
                <th style={th}>Form</th>
              </tr>
            </thead>

            <tbody>
              {enrichedRows.map((row, index) => (
                <tr key={row.__rowKey}>
                  {columns.map((col) => {
                    if (col.key === "rank") {
                      return <td key={col.key} style={td}>{row.rank ?? index + 1}</td>
                    }

                    if (col.key === "teamName") {
                      return (
                        <td key={col.key} style={td}>
                          {row.__teamSlug ? (
                            <Link to={`/teams/${row.__teamSlug}`} style={teamLink}>
                              {row.__teamName}
                            </Link>
                          ) : (
                            row.__teamName
                          )}
                        </td>
                      )
                    }

                    return (
                      <td key={col.key} style={td}>
                        {row[col.key] ?? "—"}
                      </td>
                    )
                  })}

                  <td style={td}>
                    <FormCell results={row.__form} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

const th = {
  textAlign: "left",
  padding: "14px 16px",
  borderBottom: "1px solid #fed7aa",
  color: "#9a3412",
  whiteSpace: "nowrap",
}

const td = {
  padding: "14px 16px",
  borderBottom: "1px solid #ffedd5",
  whiteSpace: "nowrap",
}

const teamLink = {
  color: "#f97316",
  textDecoration: "none",
  fontWeight: 700,
}

const formRow = {
  display: "inline-flex",
  gap: 6,
  alignItems: "center",
}

const formBase = {
  width: 28,
  height: 28,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 800,
}

const formWin = {
  ...formBase,
  background: "#dcfce7",
  color: "#166534",
  border: "1px solid #86efac",
}

const formLoss = {
  ...formBase,
  background: "#fee2e2",
  color: "#991b1b",
  border: "1px solid #fca5a5",
}

const formTie = {
  ...formBase,
  background: "#ffedd5",
  color: "#9a3412",
  border: "1px solid #fdba74",
}