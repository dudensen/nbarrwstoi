import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useSeason } from "../context/SeasonContext"
import {
  decodeMaybeBrokenText,
  extractTeamsFromLeagueInfo,
  slugifyTeamName as fantraxSlugifyTeamName,
} from "../utils/fantrax"
import { canonicalTeamName, slugifyTeamName } from "../utils/history"

const PLAYOFFS_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1DEXCIZjzFP6WZUM0LoPP_LVjC1RVFYkTV3gizVxd0ps/export?format=csv&gid=0"

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
  const n = Number(String(value ?? "").replace(",", "."))
  return Number.isFinite(n) ? n : null
}

function getSeasonEndYear(seasonKey) {
  const m = String(seasonKey || "").match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  return Number(String(m[1]).slice(0, 2) + m[2])
}

function getTeamIdFromStandingsRow(row) {
  return row?.teamId || row?.id || row?.franchiseId || row?.team?.id || ""
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

function getDisplayColumns(rows, isHistorical) {
  if (isHistorical) {
    return [
      { key: "rank", label: "#" },
      { key: "teamName", label: "Team" },
      { key: "points", label: "Points" },
      { key: "record", label: "Record" },
      { key: "gamesBack", label: "GB" },
    ]
  }

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
    const slug = fantraxSlugifyTeamName(decodedName)

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

function buildHistoricalTeamMetaMap(rows = [], seasonKey = "") {
  const seasonEndYear = getSeasonEndYear(seasonKey)
  const byId = new Map()
  const byName = new Map()

  if (!seasonEndYear) return { byId, byName }

  const seen = new Set()

  for (const row of rows) {
    if (Number(row?.year) !== seasonEndYear) continue

    const teamName = canonicalTeamName(row?.team || "")
    if (!teamName) continue

    const key = normalizeName(teamName)
    if (seen.has(key)) continue
    seen.add(key)

    const item = {
      id: teamName,
      name: teamName,
      slug: slugifyTeamName(teamName),
    }

    byId.set(teamName, item)
    byName.set(key, item)
  }

  return { byId, byName }
}

function buildFormMap(matchupResults) {
  const byTeamId = new Map()

  for (const matchup of matchupResults?.matchups || []) {
    const teams = Array.isArray(matchup?.teams) ? matchup.teams : []
    if (teams.length < 2) continue

    const winnerTeamId =
      matchup?.winnerTeamId == null ? null : String(matchup.winnerTeamId)
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

function buildHistoricalFormMap(rows = [], seasonKey = "") {
  const seasonEndYear = getSeasonEndYear(seasonKey)
  const byTeam = new Map()

  if (!seasonEndYear) return byTeam

  const relevantRows = rows
    .filter((row) => Number(row?.year) === seasonEndYear && s(row?.team))
    .sort((a, b) => {
      const periodDiff = Number(a?.period || 0) - Number(b?.period || 0)
      if (periodDiff !== 0) return periodDiff
      return Number(a?.matchNo || 0) - Number(b?.matchNo || 0)
    })

  for (const row of relevantRows) {
    const teamName = canonicalTeamName(row?.team || "")
    if (!teamName) continue

    let result = "T"
    const gamesWon = Number(row?.gamesWon || 0)

    if (gamesWon === 1) result = "W"
    else if (gamesWon === 0) result = "L"

    if (!byTeam.has(teamName)) byTeam.set(teamName, [])
    byTeam.get(teamName).push({
      period: Number(row?.period || 0),
      result,
    })
  }

  for (const [teamName, items] of byTeam.entries()) {
    byTeam.set(teamName, items.slice(-5))
  }

  return byTeam
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

function parseCsvMatrix(text = "") {
  const rows = []
  let current = []
  let value = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        value += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === "," && !inQuotes) {
      current.push(value)
      value = ""
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++
      current.push(value)
      rows.push(current)
      current = []
      value = ""
    } else {
      value += ch
    }
  }

  if (value.length || current.length) {
    current.push(value)
    rows.push(current)
  }

  return rows
}

function buildPlayoffSummaryFromMatrix(matrix, seasonKey) {
  const seasonEndYear = getSeasonEndYear(seasonKey)
  if (!seasonEndYear) return null

  if (!Array.isArray(matrix) || matrix.length < 2) {
    return null
  }

  const dataRows = matrix.slice(1)

  const playoffRows = dataRows.filter((row) => {
    const year = toNumberOrNull(row?.[0])
    const phase = normalizeName(row?.[1])
    return year === seasonEndYear && phase === "playoffs"
  })

  if (!playoffRows.length) {
    return null
  }

  const finalRows = playoffRows.filter((row) => {
    const periodLabel = normalizeName(row?.[2])
    return periodLabel === "final"
  })

  if (finalRows.length < 2) {
    return null
  }

  const championRow =
    finalRows.find((row) => toNumberOrNull(row?.[6]) === 1) || null

  const runnerUpRow =
    finalRows.find((row) => toNumberOrNull(row?.[6]) === 0) || null

  if (!championRow || !runnerUpRow) {
    return null
  }

  return {
    champion: {
      team: canonicalTeamName(decodeMaybeBrokenText(s(championRow?.[4]))),
      wins: toNumberOrNull(championRow?.[7]) ?? 0,
      losses: toNumberOrNull(championRow?.[8]) ?? 0,
      ties: toNumberOrNull(championRow?.[9]) ?? 0,
    },
    runnerUp: {
      team: canonicalTeamName(decodeMaybeBrokenText(s(runnerUpRow?.[4]))),
      wins: toNumberOrNull(runnerUpRow?.[7]) ?? 0,
      losses: toNumberOrNull(runnerUpRow?.[8]) ?? 0,
      ties: toNumberOrNull(runnerUpRow?.[9]) ?? 0,
    },
  }
}

function resolvePlayoffTeam(teamName, teamMeta) {
  if (!teamName) return { name: "—", slug: "" }

  const found = teamMeta.byName.get(normalizeName(teamName))
  if (found) return found

  return {
    name: teamName,
    slug: slugifyTeamName(teamName),
  }
}

function formatPct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return `${(n * 100).toFixed(1)}%`
}

function buildHistoricalStandings(rows = [], seasonKey = "") {
  const seasonEndYear = getSeasonEndYear(seasonKey)
  if (!seasonEndYear) return []

  const relevantRows = rows.filter(
    (row) => Number(row?.year) === seasonEndYear && normalizeName(row?.phase) === "regular"
  )

  const byTeam = new Map()

  for (const row of relevantRows) {
    const teamName = canonicalTeamName(row?.team || "")
    if (!teamName) continue

    if (!byTeam.has(teamName)) {
      byTeam.set(teamName, {
        teamId: teamName,
        teamName,
        managerCounts: new Map(),
        matchupWins: 0,
        matchupLosses: 0,
        matchupTies: 0,
        categoryWins: 0,
        categoryLosses: 0,
        categoryTies: 0,
      })
    }

    const entry = byTeam.get(teamName)
    const manager = s(row?.manager)
    if (manager) {
      entry.managerCounts.set(manager, (entry.managerCounts.get(manager) || 0) + 1)
    }

    entry.matchupWins += Number(row?.gamesWon === 1 ? 1 : 0)
    entry.matchupLosses += Number(row?.gamesWon === 0 ? 1 : 0)
    entry.matchupTies += Number(row?.gamesWon !== 1 && row?.gamesWon !== 0 ? 1 : 0)

    entry.categoryWins += Number(row?.wins || 0)
    entry.categoryLosses += Number(row?.losses || 0)
    entry.categoryTies += Number(row?.ties || 0)
  }

    const rowsOut = Array.from(byTeam.values()).map((entry) => {
    return {
      id: entry.teamId,
      teamId: entry.teamId,
      teamName: entry.teamName,
      wins: entry.matchupWins,
      losses: entry.matchupLosses,
      ties: entry.matchupTies,
      points: entry.matchupWins,
      record: `${entry.matchupWins}-${entry.matchupLosses}-${entry.matchupTies}`,
      categoryWinsRaw: entry.categoryWins,
      categoryLossesRaw: entry.categoryLosses,
      categoryTiesRaw: entry.categoryTies,
    }
  })

  rowsOut.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.categoryWinsRaw !== a.categoryWinsRaw) return b.categoryWinsRaw - a.categoryWinsRaw
    if (a.categoryLossesRaw !== b.categoryLossesRaw) return a.categoryLossesRaw - b.categoryLossesRaw
    if (b.categoryPct !== a.categoryPct) return b.categoryPct - a.categoryPct

    return String(a.teamName).localeCompare(String(b.teamName), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  })

  return rowsOut.map((row, index) => ({
    ...row,
    rank: index + 1,
    gamesBack: rowsOut.length
      ? Math.max(0, rowsOut[0].points - row.points)
      : 0,
  }))
}

export default function StandingsPage() {
  const { season } = useSeason()

  const [rows, setRows] = useState([])
  const [leagueInfo, setLeagueInfo] = useState(null)
  const [matchupResults, setMatchupResults] = useState(null)
  const [historyPayload, setHistoryPayload] = useState(null)
  const [playoffSummary, setPlayoffSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const isHistoricalSeason = season?.dataSource === "history"

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        let nextRows = []
        let nextLeagueInfo = null
        let nextMatchupResults = null
        let nextHistoryPayload = null
        let nextPlayoffSummary = null

        if (isHistoricalSeason) {
          const [historyRes, sheetRes] = await Promise.allSettled([
            fetch("/data/history-data.json"),
            fetch(PLAYOFFS_SHEET_CSV_URL),
          ])

          if (historyRes.status !== "fulfilled") {
            throw new Error("Failed to reach history dataset.")
          }

          const historyText = await historyRes.value.text()
          if (!historyRes.value.ok) {
            throw new Error(`History data failed (${historyRes.value.status}): ${historyText}`)
          }

          nextHistoryPayload = JSON.parse(historyText)
          nextRows = buildHistoricalStandings(nextHistoryPayload?.rows || [], season.key)

          if (sheetRes.status === "fulfilled" && sheetRes.value.ok) {
            const sheetText = await sheetRes.value.text()
            const matrix = parseCsvMatrix(sheetText)
            const summary = buildPlayoffSummaryFromMatrix(matrix, season.key)
            if (summary) nextPlayoffSummary = summary
          }
        } else {
          const matchupFile = `/data/matchup-results-${encodeURIComponent(season.key)}.json`

          const [standingsRes, leagueRes, matchupRes, sheetRes] =
            await Promise.allSettled([
              fetch(`/api/standings?season=${encodeURIComponent(season.key)}`),
              fetch(`/api/league-info?season=${encodeURIComponent(season.key)}`),
              fetch(matchupFile),
              fetch(PLAYOFFS_SHEET_CSV_URL),
            ])

          if (standingsRes.status !== "fulfilled") {
            throw new Error("Failed to reach standings endpoint.")
          }

          const standingsText = await standingsRes.value.text()
          if (!standingsRes.value.ok) {
            throw new Error(
              `Request failed (${standingsRes.value.status}): ${standingsText}`
            )
          }

          const parsedStandings = JSON.parse(standingsText)
          nextRows = Array.isArray(parsedStandings) ? parsedStandings : []

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

          if (sheetRes.status === "fulfilled" && sheetRes.value.ok) {
            const sheetText = await sheetRes.value.text()
            const matrix = parseCsvMatrix(sheetText)
            const summary = buildPlayoffSummaryFromMatrix(matrix, season.key)

            if (summary) {
              nextPlayoffSummary = summary
            }
          }
        }

        if (!cancelled) {
          setRows(nextRows)
          setLeagueInfo(nextLeagueInfo)
          setMatchupResults(nextMatchupResults)
          setHistoryPayload(nextHistoryPayload)
          setPlayoffSummary(nextPlayoffSummary)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setRows([])
          setLeagueInfo(null)
          setMatchupResults(null)
          setHistoryPayload(null)
          setPlayoffSummary(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [season.key, isHistoricalSeason])

  const columns = useMemo(
    () => getDisplayColumns(rows, isHistoricalSeason),
    [rows, isHistoricalSeason]
  )

  const teamMeta = useMemo(() => {
    if (isHistoricalSeason) {
      return buildHistoricalTeamMetaMap(historyPayload?.rows || [], season.key)
    }
    return buildTeamMetaMap(leagueInfo)
  }, [historyPayload, isHistoricalSeason, leagueInfo, season.key])

  const formMap = useMemo(() => {
    if (isHistoricalSeason) {
      return buildHistoricalFormMap(historyPayload?.rows || [], season.key)
    }
    return buildFormMap(matchupResults)
  }, [historyPayload, isHistoricalSeason, matchupResults, season.key])

  const enrichedRows = useMemo(() => {
    return rows.map((row, index) => {
      const rowTeamId = String(getTeamIdFromStandingsRow(row) || row?.teamId || row?.id || "")
      const rowTeamName = getTeamNameFromStandingsRow(row) || canonicalTeamName(row?.teamName || "")

      const teamFromId = rowTeamId ? teamMeta.byId.get(rowTeamId) : null
      const teamFromName = rowTeamName
        ? teamMeta.byName.get(normalizeName(rowTeamName))
        : null
      const resolvedTeam = teamFromId || teamFromName || null
      const resolvedTeamId = resolvedTeam?.id || rowTeamId || rowTeamName || ""
      const form = resolvedTeamId ? formMap.get(resolvedTeamId) || [] : []

      return {
        ...row,
        __rowKey: `${resolvedTeamId || rowTeamName || "team"}-${index}`,
        __teamName: resolvedTeam?.name || rowTeamName || "—",
        __teamSlug:
          resolvedTeam?.slug ||
          (rowTeamName ? slugifyTeamName(rowTeamName) : ""),
        __form: form,
      }
    })
  }, [rows, teamMeta, formMap])

  const champion = playoffSummary?.champion
    ? {
        ...playoffSummary.champion,
        ...resolvePlayoffTeam(playoffSummary.champion.team, teamMeta),
      }
    : null

  const runnerUp = playoffSummary?.runnerUp
    ? {
        ...playoffSummary.runnerUp,
        ...resolvePlayoffTeam(playoffSummary.runnerUp.team, teamMeta),
      }
    : null

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
          {isHistoricalSeason
            ? "Historical standings built from the pre-Fantrax spreadsheet data."
            : "This page reads the selected season and hits the matching Fantrax league automatically."}
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
        <>
          {champion && runnerUp && (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #fed7aa",
                borderRadius: 20,
                padding: 20,
                marginBottom: 20,
              }}
            >
              <div style={{ color: "#f97316", fontWeight: 700, marginBottom: 8 }}>
                Final Match
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 16,
                }}
              >
                <div style={playoffCard}>
                  <div style={playoffTitle}>Champion</div>
                  {champion?.slug ? (
                    <Link
                      to={`/teams/${champion.slug}?season=${encodeURIComponent(season.key)}`}
                      style={playoffLink}
                    >
                      {champion.name}
                    </Link>
                  ) : (
                    <div style={playoffName}>{champion?.name || "—"}</div>
                  )}
                  <div style={playoffMeta}>
                    {champion?.wins ?? "—"}-{champion?.losses ?? "—"}-{champion?.ties ?? "—"}
                  </div>
                </div>

                <div style={playoffCard}>
                  <div style={playoffTitle}>Runner-up</div>
                  {runnerUp?.slug ? (
                    <Link
                      to={`/teams/${runnerUp.slug}?season=${encodeURIComponent(season.key)}`}
                      style={playoffLink}
                    >
                      {runnerUp.name}
                    </Link>
                  ) : (
                    <div style={playoffName}>{runnerUp?.name || "—"}</div>
                  )}
                  <div style={playoffMeta}>
                    {runnerUp?.wins ?? "—"}-{runnerUp?.losses ?? "—"}-{runnerUp?.ties ?? "—"}
                  </div>
                </div>
              </div>
            </div>
          )}

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
                        return (
                          <td key={col.key} style={td}>
                            {row.rank ?? index + 1}
                          </td>
                        )
                      }

                      if (col.key === "teamName") {
                        return (
                          <td key={col.key} style={td}>
                            {row.__teamSlug ? (
                              <Link
                                to={`/teams/${row.__teamSlug}?season=${encodeURIComponent(season.key)}`}
                                style={teamLink}
                              >
                                {row.__teamName}
                              </Link>
                            ) : (
                              row.__teamName
                            )}
                          </td>
                        )
                      }

                      if (col.key === "percentage") {
                        return (
                          <td key={col.key} style={td}>
                            {isHistoricalSeason ? formatPct(row[col.key]) : row[col.key] ?? "—"}
                          </td>
                        )
                      }

                      if (col.key === "categoryPct") {
                        return (
                          <td key={col.key} style={td}>
                            {formatPct(row[col.key])}
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
        </>
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

const playoffCard = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 16,
  padding: 16,
}

const playoffTitle = {
  color: "#f97316",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 8,
}

const playoffName = {
  fontSize: 22,
  fontWeight: 800,
  color: "#111827",
}

const playoffLink = {
  fontSize: 22,
  fontWeight: 800,
  color: "#111827",
  textDecoration: "none",
}

const playoffMeta = {
  color: "#6b7280",
  marginTop: 8,
  fontSize: 14,
}