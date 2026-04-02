import { useEffect, useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { useSeason } from "../context/SeasonContext"
import { getSeasonByKey } from "../config/seasons"
import {
  decodeMaybeBrokenText,
  getTeamMatchups,
  buildPlayerLookupFromAdp,
  buildPlayerLookupFromCsvRows,
  mergePlayerLookups,
  parsePlayerCsv,
  getRosterForTeam,
  enrichRosterItems,
  slugifyTeamName,
} from "../utils/fantrax"
import {
  buildRecords,
  canonicalTeamName,
  formatNumber,
  getHistoricalTeamProfile,
} from "../utils/history"

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
  const parts = String(scoreText || "")
    .split("-")
    .map((s) => s.trim())
  if (parts.length !== 2) return scoreText || "—"
  return `${formatScoreValue(parts[0])} - ${formatScoreValue(parts[1])}`
}

function slugifyPlayerName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function PlayerLinkCell({ playerName }) {
  const cleanName = decodeMaybeBrokenText(playerName || "")
  if (!cleanName) return <span>—</span>

  return (
    <Link to={`/players/${slugifyPlayerName(cleanName)}`} style={playerLink}>
      {cleanName}
    </Link>
  )
}

function TeamLogo({ teamSlug, teamName, size = 180 }) {
  return (
    <img
      src={`/team-logos/${teamSlug}.png`}
      alt={`${teamName} logo`}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        flexShrink: 0,
      }}
      onError={(e) => {
        e.currentTarget.style.display = "none"
      }}
    />
  )
}

function formatTransactionDate(value) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function compareDescByDate(a, b) {
  const aTime = new Date(a?.date || 0).getTime()
  const bTime = new Date(b?.date || 0).getTime()
  return bTime - aTime
}

function transactionTypeLabel(types = []) {
  if (!Array.isArray(types) || types.length === 0) return "—"
  return types.join(" + ")
}

function playerTypeColor(type) {
  const t = String(type || "").toUpperCase()
  if (t === "FA" || t === "WW") return "#15803d"
  if (t === "DROP") return "#b91c1c"
  return "#92400e"
}

function extractTeamsFromLeagueInfoSafe(leagueInfo) {
  const seen = new Map()

  for (const period of leagueInfo?.matchups || []) {
    for (const matchup of period?.matchupList || []) {
      for (const side of [matchup?.away, matchup?.home]) {
        if (!side?.id) continue
        if (seen.has(side.id)) continue
        seen.set(side.id, {
          ...side,
          name: decodeMaybeBrokenText(side?.name || ""),
          shortName: decodeMaybeBrokenText(side?.shortName || ""),
        })
      }
    }
  }

  return Array.from(seen.values())
}

function getTeamByFranchiseSlugFromLeagueInfo(leagueInfo, teamSlug) {
  const targetSlug = String(teamSlug || "").trim().toLowerCase()
  if (!targetSlug) return null

  const teams = extractTeamsFromLeagueInfoSafe(leagueInfo)

  return (
    teams.find((candidate) => {
      const rawName = decodeMaybeBrokenText(candidate?.name || "")
      return slugifyTeamName(canonicalTeamName(rawName)) === targetSlug
    }) || null
  )
}

function FranchiseRecordsCard({
  historyPayload,
  franchiseRecordRows,
  franchiseRecordCount,
}) {
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <h3 style={{ margin: 0 }}>Franchise Records</h3>
        <div style={{ color: "#9a3412", fontWeight: 700 }}>
          {formatNumber(franchiseRecordCount)} all-time records
        </div>
      </div>

      {!historyPayload ? (
        <div style={{ color: "#6b7280" }}>History data not available.</div>
      ) : franchiseRecordRows.length === 0 ? (
        <div style={{ color: "#6b7280" }}>
          No all-time records found for this franchise.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fff7ed" }}>
                <th style={th}>Record</th>
                <th style={th}>Value</th>
                <th style={th}>Year</th>
                <th style={th}>Phase</th>
                <th style={th}>Opponent</th>
              </tr>
            </thead>
            <tbody>
              {franchiseRecordRows.map((record) => (
                <tr key={record.key}>
                  <td style={td}>{record.label}</td>
                  <td style={td}>{String(record.top?.[record.key] ?? "—")}</td>
                  <td style={td}>{record.top?.year ?? "—"}</td>
                  <td style={td}>{record.top?.phase ?? "—"}</td>
                  <td style={td}>
                    {record.top?.opponent ? (
                      <Link
                        to={`/teams/${slugifyTeamName(record.top.opponent)}`}
                        style={teamLink}
                      >
                        {record.top.opponent}
                      </Link>
                    ) : (
                      "—"
                    )}
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

function MiniStat({ label, value }) {
  return (
    <div style={miniStatCard}>
      <div style={miniStatLabel}>{label}</div>
      <div style={miniStatValue}>{value}</div>
    </div>
  )
}

function HistoricalTeamMode({
  historicalProfile,
  teamManagerName,
  historyPayload,
  franchiseRecordRows,
  franchiseRecordCount,
  teamSlug,
}) {
  return (
    <main style={main}>
      <Link to="/teams" style={backLink}>
        ← Back to teams
      </Link>

      <div style={card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <div style={eyebrow}>Historical Team Profile</div>
            <h1 style={{ margin: "0 0 10px" }}>{historicalProfile.team}</h1>
            <div style={{ color: "#6b7280" }}>
              Years active: {historicalProfile.firstYear} - {historicalProfile.lastYear}
            </div>
            <div style={{ color: "#6b7280", marginTop: 6 }}>
              Manager / Owner: {teamManagerName || "—"}
            </div>
          </div>

          <TeamLogo
            teamSlug={teamSlug}
            teamName={historicalProfile.team}
            size={180}
          />
        </div>
      </div>

      <FranchiseRecordsCard
        historyPayload={historyPayload}
        franchiseRecordRows={franchiseRecordRows}
        franchiseRecordCount={franchiseRecordCount}
      />

      <div style={card}>
        <div style={summaryGrid}>
          <MiniStat
            label="Matchups"
            value={formatNumber(historicalProfile.matches)}
          />
          <MiniStat
            label="Games Won"
            value={formatNumber(historicalProfile.gamesWon, 1)}
          />
          <MiniStat
            label="W-L-D"
            value={`${formatNumber(historicalProfile.wins)}-${formatNumber(
              historicalProfile.losses
            )}-${formatNumber(historicalProfile.ties)}`}
          />
          <MiniStat
            label="Regular Matchups"
            value={formatNumber(historicalProfile.regularMatches)}
          />
          <MiniStat
            label="Playoff Matchups"
            value={formatNumber(historicalProfile.playoffMatches)}
          />
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Season-by-Season History</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fff7ed" }}>
                <th style={th}>Year</th>
                <th style={th}>Matchups</th>
                <th style={th}>Games Won</th>
                <th style={th}>W-L-D</th>
                <th style={th}>Regular</th>
                <th style={th}>Playoffs</th>
              </tr>
            </thead>
            <tbody>
              {historicalProfile.seasons.map((row) => (
                <tr key={row.year}>
                  <td style={td}>{row.year}</td>
                  <td style={td}>{formatNumber(row.matches)}</td>
                  <td style={td}>{formatNumber(row.gamesWon, 1)}</td>
                  <td style={td}>
                    {row.wins}-{row.losses}-{row.ties}
                  </td>
                  <td style={td}>{formatNumber(row.regularMatches)}</td>
                  <td style={td}>{formatNumber(row.playoffMatches)}</td>
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
                  <td style={td}>
                    <PlayerLinkCell playerName={row.playerName} />
                  </td>
                  <td style={td}>{row.playerPos || "—"}</td>
                  <td style={td}>{row.position || "—"}</td>
                  <td style={td}>
                    {typeof row.playerAdp === "number"
                      ? row.playerAdp.toFixed(2)
                      : "—"}
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

export default function TeamDetailPage() {
  const { teamSlug } = useParams()
  const { season } = useSeason()
  const [searchParams] = useSearchParams()

  const overrideSeasonKey = searchParams.get("season") || ""
  const effectiveSeason = overrideSeasonKey
    ? getSeasonByKey(overrideSeasonKey)
    : season

  const [leagueInfo, setLeagueInfo] = useState(null)
  const [teamRosters, setTeamRosters] = useState(null)
  const [adpRows, setAdpRows] = useState([])
  const [playerCsvRows, setPlayerCsvRows] = useState([])
  const [matchupResults, setMatchupResults] = useState(null)
  const [transactionsData, setTransactionsData] = useState(null)
  const [historyPayload, setHistoryPayload] = useState(null)
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

        const matchupFile = `/data/matchup-results-${encodeURIComponent(
          effectiveSeason.key
        )}.json`
        const transactionsFile = `/data/transactions-${encodeURIComponent(
          effectiveSeason.key
        )}.json`
        const csvLoader =
          playerCsvFiles[`../config/playerCsv/${effectiveSeason.key}.csv`]

        const [
          leagueRes,
          rosterRes,
          adpRes,
          matchupRes,
          transactionsRes,
          historyRes,
          csvText,
        ] = await Promise.all([
          fetch(
            `/api/league-info?season=${encodeURIComponent(effectiveSeason.key)}`
          ),
          fetch(
            `/api/team-rosters?season=${encodeURIComponent(
              effectiveSeason.key
            )}&period=${encodeURIComponent(period)}`
          ),
          fetch(`/api/adp`),
          fetch(matchupFile),
          fetch(transactionsFile).catch(() => null),
          fetch("/data/history-data.json").catch(() => null),
          csvLoader ? csvLoader() : Promise.resolve(""),
        ])

        const [
          leagueText,
          rosterText,
          adpText,
          matchupText,
          transactionsText,
          historyText,
        ] = await Promise.all([
          leagueRes.text(),
          rosterRes.text(),
          adpRes.text(),
          matchupRes.text(),
          transactionsRes ? transactionsRes.text() : Promise.resolve(""),
          historyRes ? historyRes.text() : Promise.resolve(""),
        ])

        if (!leagueRes.ok) {
          throw new Error(`League info failed (${leagueRes.status}): ${leagueText}`)
        }
        if (!rosterRes.ok) {
          throw new Error(`Team rosters failed (${rosterRes.status}): ${rosterText}`)
        }
        if (!adpRes.ok) {
          throw new Error(`ADP failed (${adpRes.status}): ${adpText}`)
        }
        if (!matchupRes.ok) {
          throw new Error(
            `Matchup results failed (${matchupRes.status}): ${matchupText}`
          )
        }

        let parsedTransactions = null
        if (transactionsRes && transactionsRes.ok && transactionsText) {
          parsedTransactions = JSON.parse(transactionsText)
        }

        let parsedHistory = null
        if (historyRes && historyRes.ok && historyText) {
          parsedHistory = JSON.parse(historyText)
        }

        if (!cancelled) {
          setLeagueInfo(JSON.parse(leagueText))
          setTeamRosters(JSON.parse(rosterText))
          setAdpRows(JSON.parse(adpText))
          setPlayerCsvRows(parsePlayerCsv(csvText || ""))
          setMatchupResults(JSON.parse(matchupText))
          setTransactionsData(parsedTransactions)
          setHistoryPayload(parsedHistory)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setLeagueInfo(null)
          setTeamRosters(null)
          setAdpRows([])
          setPlayerCsvRows([])
          setMatchupResults(null)
          setTransactionsData(null)
          setHistoryPayload(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [effectiveSeason.key, period])

  const team = useMemo(() => {
    return getTeamByFranchiseSlugFromLeagueInfo(leagueInfo, teamSlug)
  }, [leagueInfo, teamSlug])

  const historicalProfile = useMemo(() => {
    const rows = historyPayload?.rows || []
    return getHistoricalTeamProfile(rows, teamSlug)
  }, [historyPayload, teamSlug])

  const teamId = team?.id || ""

  const canonicalTeam = useMemo(() => {
    if (team) {
      return canonicalTeamName(decodeMaybeBrokenText(team?.name || ""))
    }
    return canonicalTeamName(historicalProfile?.team || "")
  }, [team, historicalProfile])

  const teamManagerName = useMemo(() => {
    if (historicalProfile?.manager) return historicalProfile.manager

    const raw =
      team?.manager ||
      team?.owner ||
      team?.managerName ||
      team?.ownerName ||
      team?.managers?.[0]?.name ||
      ""

    return decodeMaybeBrokenText(raw || "")
  }, [team, historicalProfile])

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
      const aAdp =
        typeof a?.playerAdp === "number" ? a.playerAdp : Number.POSITIVE_INFINITY
      const bAdp =
        typeof b?.playerAdp === "number" ? b.playerAdp : Number.POSITIVE_INFINITY
      if (aAdp !== bAdp) return aAdp - bAdp
      return String(a?.playerName || "").localeCompare(
        String(b?.playerName || "")
      )
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
    () =>
      sortRosterByAdp(rosterItems.filter((p) => p.status === "INJURED_RESERVE")),
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
          matchup?.winnerTeamId == null ? "T" : isWinner ? "W" : "L",
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

  const teamTransactions = useMemo(() => {
    const rows = Array.isArray(transactionsData?.transactions)
      ? transactionsData.transactions
      : []
    return rows
      .filter((tx) => String(tx?.team?.id || "") === String(teamId))
      .sort(compareDescByDate)
  }, [transactionsData, teamId])

  const franchiseRecordRows = useMemo(() => {
    const rows = historyPayload?.rows || []
    const allRecords = buildRecords(rows)

    return allRecords
      .filter((record) => record?.top?.team === canonicalTeam)
      .sort((a, b) =>
        String(a.label || "").localeCompare(String(b.label || ""))
      )
  }, [historyPayload, canonicalTeam])

  const franchiseRecordCount = franchiseRecordRows.length

  if (loading) {
    return (
      <main style={main}>
        <div>Loading team profile...</div>
      </main>
    )
  }

  if (error) {
    return (
      <main style={main}>
        <div style={errorBox}>{error}</div>
      </main>
    )
  }

  if (!team && !historicalProfile) {
    return (
      <main style={main}>
        <div style={errorBox}>
          Team not found for this season or in historical records.
        </div>
      </main>
    )
  }

  if (!team && historicalProfile) {
    return (
      <HistoricalTeamMode
        historicalProfile={historicalProfile}
        teamManagerName={teamManagerName}
        historyPayload={historyPayload}
        franchiseRecordRows={franchiseRecordRows}
        franchiseRecordCount={franchiseRecordCount}
        teamSlug={teamSlug}
      />
    )
  }

  return (
    <main style={main}>
      <Link to="/teams" style={backLink}>
        ← Back to teams
      </Link>

      <div style={card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <div style={eyebrow}>Team Profile</div>
            <h1 style={{ margin: "0 0 10px" }}>{canonicalTeam}</h1>
            <div style={{ color: "#6b7280" }}>Season: {effectiveSeason.label}</div>
            <div style={{ color: "#6b7280", marginTop: 6 }}>
              Manager / Owner: {teamManagerName || "—"}
            </div>
          </div>

          <TeamLogo
            teamSlug={teamSlug}
            teamName={canonicalTeam}
            size={220}
          />
        </div>
      </div>

      <FranchiseRecordsCard
        historyPayload={historyPayload}
        franchiseRecordRows={franchiseRecordRows}
        franchiseRecordCount={franchiseRecordCount}
      />

      <div style={card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <h3 style={{ margin: 0 }}>Roster</h3>
          <label>
            Period{" "}
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {Array.from({ length: 22 }, (_, i) => String(i + 1)).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
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
          <button
            type="button"
            onClick={() => setActiveTab("transactions")}
            style={activeTab === "transactions" ? activeTabBtn : tabBtn}
          >
            Transactions
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
                          <Link
                            to={`/teams/${slugifyTeamName(row.opponentName)}`}
                            style={teamLink}
                          >
                            {row.opponentName}
                          </Link>
                        ) : (
                          row.opponentName
                        )}
                      </td>
                      <td
                        style={{
                          ...td,
                          fontWeight: 700,
                          color:
                            row.result === "W"
                              ? "#15803d"
                              : row.result === "L"
                              ? "#b91c1c"
                              : "#92400e",
                        }}
                      >
                        {row.result}
                      </td>
                      <td style={td}>{row.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : activeTab === "schedule" ? (
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
                          <Link
                            to={`/teams/${slugifyTeamName(row.opponentName)}`}
                            style={teamLink}
                          >
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
        ) : (
          <>
            <h3 style={sectionTitle}>Transactions</h3>
            {teamTransactions.length === 0 ? (
              <div>
                No transactions found for this team in {effectiveSeason.label}.
              </div>
            ) : (
              <div style={transactionsList}>
                {teamTransactions.map((tx) => (
                  <div key={tx.id} style={transactionCard}>
                    <div style={transactionHeader}>
                      <div>
                        <div style={transactionDate}>
                          {formatTransactionDate(tx.date)}
                        </div>
                        <div style={transactionTypes}>
                          {transactionTypeLabel(tx.types)}
                        </div>
                      </div>
                      <div style={transactionTeam}>
                        {decodeMaybeBrokenText(tx?.team?.name || "—")}
                      </div>
                    </div>

                    <div style={transactionPlayers}>
                      {(tx.players || []).map((player) => (
                        <div
                          key={`${tx.id}-${player.id}-${player.type}`}
                          style={transactionPlayerRow}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              style={{
                                ...playerTypeBadge,
                                color: playerTypeColor(player.type),
                                borderColor: playerTypeColor(player.type),
                              }}
                            >
                              {player.type || "—"}
                            </span>
                            <PlayerLinkCell
                              playerName={player.name || player.playerName || "—"}
                            />
                            <span style={transactionPlayerMeta}>
                              {player.pos_short_name || "—"} ·{" "}
                              {player.team_name || "—"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
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

const summaryGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
}

const miniStatCard = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 18,
  padding: 16,
}

const miniStatLabel = {
  fontSize: 13,
  fontWeight: 700,
  color: "#9a3412",
}

const miniStatValue = {
  marginTop: 8,
  fontSize: 20,
  fontWeight: 800,
  color: "#111827",
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

const transactionsList = {
  display: "grid",
  gap: 14,
}

const transactionCard = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 18,
  padding: 18,
}

const transactionHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 14,
}

const transactionDate = {
  color: "#111827",
  fontWeight: 800,
  marginBottom: 6,
}

const transactionTypes = {
  color: "#9a3412",
  fontWeight: 700,
  fontSize: 14,
}

const transactionTeam = {
  color: "#6b7280",
  fontWeight: 600,
}

const transactionPlayers = {
  display: "grid",
  gap: 10,
}

const transactionPlayerRow = {
  background: "#ffffff",
  border: "1px solid #ffedd5",
  borderRadius: 14,
  padding: "12px 14px",
}

const playerTypeBadge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 52,
  padding: "4px 9px",
  borderRadius: 999,
  border: "1px solid currentColor",
  fontSize: 12,
  fontWeight: 800,
  background: "#fff",
}

const transactionPlayerMeta = {
  color: "#6b7280",
  fontSize: 14,
}

const playerLink = {
  color: "#111827",
  fontWeight: 700,
  textDecoration: "none",
}