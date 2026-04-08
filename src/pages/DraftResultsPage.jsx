import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useSeason } from "../context/SeasonContext"
import { SEASONS } from "../config/seasons"
import { HISTORICAL_DRAFT_RESULTS } from "../config/historicalDraftResults"
import {
  buildPlayerLookupFromAdp,
  buildPlayerLookupFromCsvRows,
  parsePlayerCsv,
  mergePlayerLookups,
  enrichDraftPicks,
  getPlayerTeamMapFromRosters,
  getTeamNameMapFromRosters,
  slugifyTeamName,
} from "../utils/fantrax"
import { canonicalTeamName } from "../utils/history"

const playerCsvFiles = import.meta.glob("../config/playerCsv/*.csv", {
  query: "?raw",
  import: "default",
})


function isHistoricalSeason(seasonKey) {
  const seasonMeta = SEASONS.find((s) => s.key === seasonKey)
  return !seasonMeta?.leagueId
}

function slugifyPlayerName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function normalizeLooseName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function getAdpRowName(row) {
  const raw =
    row?.name ||
    row?.playerName ||
    row?.fullName ||
    row?.Player ||
    row?.player?.name ||
    [row?.firstName, row?.lastName].filter(Boolean).join(" ") ||
    [row?.first_name, row?.last_name].filter(Boolean).join(" ") ||
    ""

  return String(raw).trim()
}

function flipNameOrder(name) {
  const clean = String(name ?? "").trim()
  if (!clean) return ""

  if (clean.includes(",")) {
    return clean
      .split(",")
      .map((x) => x.trim())
      .reverse()
      .join(" ")
  }

  const parts = clean.split(/\s+/)
  if (parts.length < 2) return clean
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`
}

function findAdpRowByPlayerName(adpRows = [], playerName = "") {
  const direct = normalizeLooseName(playerName)
  const flipped = normalizeLooseName(flipNameOrder(playerName))

  if (!direct) return null

  return (
    adpRows.find((row) => {
      const rowName = getAdpRowName(row)
      const normalizedRowName = normalizeLooseName(rowName)
      const normalizedRowFlipped = normalizeLooseName(flipNameOrder(rowName))

      return (
        normalizedRowName === direct ||
        normalizedRowName === flipped ||
        normalizedRowFlipped === direct ||
        normalizedRowFlipped === flipped
      )
    }) || null
  )
}

function normalizeHistoricalDraftResults(rows = [], adpRows = []) {
  return {
    draftType: "Historical",
    draftState: "Completed",
    startDate: null,
    endDate: null,
    draftPicks: rows.map((row) => {
      const adpRow = findAdpRowByPlayerName(adpRows, row.player)

      return {
        pick: row.overall,
        round: row.round,
        pickInRound: row.pickInRound,
        time: row.time || "",
        note: row.note || "",
        teamId: slugifyTeamName(row.team),
        playerId: adpRow?.id ? String(adpRow.id) : "",
        historicalPlayerName: row.player || "",
        historicalTeamName: row.team || "",
        historicalPlayerAdp:
          adpRow?.ADP != null && Number.isFinite(Number(adpRow.ADP))
            ? Number(adpRow.ADP)
            : adpRow?.adp != null && Number.isFinite(Number(adpRow.adp))
            ? Number(adpRow.adp)
            : null,
        historicalPlayerPos: adpRow?.pos || adpRow?.position || "",
      }
    }),
  }
}

function formatDraftDate(value) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}



function formatPickTimestamp(value) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function compareValues(a, b) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1

  if (typeof a === "number" && typeof b === "number") {
    return a - b
  }

  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

function sortRows(rows, sortConfig) {
  const sorted = [...rows].sort((a, b) => {
    const result = compareValues(a?.[sortConfig.key], b?.[sortConfig.key])
    return sortConfig.direction === "asc" ? result : -result
  })
  return sorted
}

function SortableHeader({ label, columnKey, sortConfig, onSort }) {
  const active = sortConfig.key === columnKey
  const arrow = !active ? "↕" : sortConfig.direction === "asc" ? "▲" : "▼"

  return (
    <th style={th}>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        style={sortBtn}
      >
        <span>{label}</span>
        <span style={{ fontSize: 11 }}>{arrow}</span>
      </button>
    </th>
  )
}

function TeamLinkCell({ teamId, teamName }) {
  if (!teamId || !teamName || teamName === "Free Agent" || teamName === "—") {
    return (
      <span
        style={
          teamName === "Free Agent"
            ? { color: "#f97316", fontWeight: 700 }
            : undefined
        }
      >
        {teamName || "—"}
      </span>
    )
  }

  const canonicalName = canonicalTeamName(teamName) || teamName

  return (
    <Link to={`/teams/${slugifyTeamName(canonicalName)}`} style={teamLink}>
      {teamName}
    </Link>
  )
}

export default function DraftResultsPage() {
  const { season } = useSeason()
  const historicalSeason = isHistoricalSeason(season.key)

  const [draftResults, setDraftResults] = useState(null)
  const [adpRows, setAdpRows] = useState([])
  const [playerCsvRows, setPlayerCsvRows] = useState([])
  const [teamRosters, setTeamRosters] = useState(null)
  const [period17Rosters, setPeriod17Rosters] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [roundFilter, setRoundFilter] = useState("all")
  const [viewMode, setViewMode] = useState("all")
  const [allSort, setAllSort] = useState({ key: "pick", direction: "asc" })
  const [teamSort, setTeamSort] = useState({ key: "pick", direction: "asc" })

  useEffect(() => {
    let cancelled = false

    async function load() {
  try {
    setLoading(true)
    setError("")

    const csvLoader = playerCsvFiles[`../config/playerCsv/${season.key}.csv`]

    if (historicalSeason) {
      const [adpRes, csvText] = await Promise.all([
        fetch(`/api/adp`),
        csvLoader ? csvLoader() : Promise.resolve(""),
      ])

      const adpText = await adpRes.text()
      if (!adpRes.ok) throw new Error(`ADP failed (${adpRes.status}): ${adpText}`)

      const adpJson = JSON.parse(adpText)
      const manualRows = HISTORICAL_DRAFT_RESULTS[season.key] || []

      if (!cancelled) {
        setDraftResults(normalizeHistoricalDraftResults(manualRows, adpJson))
        setAdpRows(adpJson)
        setPlayerCsvRows(parsePlayerCsv(csvText || ""))
        setTeamRosters(null)
        setPeriod17Rosters(null)
      }
      return
    }

    const csvText = csvLoader ? await csvLoader() : ""

    const [draftRes, adpRes, rostersRes, period17Res] = await Promise.all([
      fetch(`/api/draft-results?season=${encodeURIComponent(season.key)}`),
      fetch(`/api/adp`),
      fetch(`/api/team-rosters?season=${encodeURIComponent(season.key)}&period=1`),
      fetch(`/api/team-rosters?season=${encodeURIComponent(season.key)}&period=17`),
    ])

    const [draftText, adpText, rostersText, period17Text] = await Promise.all([
      draftRes.text(),
      adpRes.text(),
      rostersRes.text(),
      period17Res.text(),
    ])

    if (!draftRes.ok) throw new Error(`Draft results failed (${draftRes.status}): ${draftText}`)
    if (!adpRes.ok) throw new Error(`ADP failed (${adpRes.status}): ${adpText}`)
    if (!rostersRes.ok) throw new Error(`Team rosters failed (${rostersRes.status}): ${rostersText}`)
    if (!period17Res.ok) throw new Error(`Period 17 rosters failed (${period17Res.status}): ${period17Text}`)

    if (!cancelled) {
      setDraftResults(JSON.parse(draftText))
      setAdpRows(JSON.parse(adpText))
      setPlayerCsvRows(parsePlayerCsv(csvText || ""))
      setTeamRosters(JSON.parse(rostersText))
      setPeriod17Rosters(JSON.parse(period17Text))
    }
  } catch (err) {
    if (!cancelled) {
      setError(err instanceof Error ? err.message : "Unknown error")
      setDraftResults(null)
      setAdpRows([])
      setPlayerCsvRows([])
      setTeamRosters(null)
      setPeriod17Rosters(null)
    }
  } finally {
    if (!cancelled) setLoading(false)
  }
}

    load()

    return () => {
      cancelled = true
    }
  }, [season.key, historicalSeason])

  const playerLookup = useMemo(() => {
    const csvLookup = buildPlayerLookupFromCsvRows(playerCsvRows)
    const adpLookup = buildPlayerLookupFromAdp(adpRows)
    return mergePlayerLookups(csvLookup, adpLookup)
  }, [playerCsvRows, adpRows])

  const teamNameMap = useMemo(() => getTeamNameMapFromRosters(teamRosters), [teamRosters])
  const playerTeamMapPeriod17 = useMemo(
    () => getPlayerTeamMapFromRosters(period17Rosters),
    [period17Rosters]
  )

  const picks = useMemo(() => {
  if (historicalSeason) {
    const rawPicks = draftResults?.draftPicks || []

    return rawPicks.map((pick) => ({
      ...pick,
      teamName: pick.historicalTeamName || pick.teamId || "—",
      playerName: pick.historicalPlayerName || "No selection",
      playerPos: pick.historicalPlayerPos || "",
      playerAdp: pick.historicalPlayerAdp,
      madePick: Boolean(pick.historicalPlayerName),
      period17Team: "—",
      period17TeamId: null,
    }))
  }

  const enriched = enrichDraftPicks(draftResults, playerLookup, teamNameMap)

  return enriched.map((pick) => {
    const period17Team =
      pick.playerId && playerTeamMapPeriod17.has(String(pick.playerId))
        ? playerTeamMapPeriod17.get(String(pick.playerId))
        : "Free Agent"

    let period17TeamId = null
    if (pick.playerId && period17Rosters?.rosters) {
      for (const [teamId, teamData] of Object.entries(period17Rosters.rosters)) {
        const found = (teamData?.rosterItems || []).some(
          (item) => String(item?.id) === String(pick.playerId)
        )
        if (found) {
          period17TeamId = teamId
          break
        }
      }
    }

    return {
      ...pick,
      period17Team,
      period17TeamId,
    }
  })
}, [
  historicalSeason,
  draftResults,
  playerLookup,
  teamNameMap,
  playerTeamMapPeriod17,
  period17Rosters,
])

  const availableRounds = useMemo(() => {
    return Array.from(new Set(picks.map((p) => p.round))).sort((a, b) => a - b)
  }, [picks])

  const filteredPicks = useMemo(() => {
    if (roundFilter === "all") return picks
    return picks.filter((p) => String(p.round) === roundFilter)
  }, [picks, roundFilter])

  const sortedAllPicks = useMemo(() => sortRows(filteredPicks, allSort), [filteredPicks, allSort])

  const picksByTeam = useMemo(() => {
    const map = new Map()

    for (const pick of filteredPicks) {
      const key = pick.teamId || pick.teamName || "unknown"
      if (!map.has(key)) {
        map.set(key, {
          teamId: key,
          teamName: pick.teamName || key,
          picks: [],
        })
      }
      map.get(key).picks.push(pick)
    }

    return Array.from(map.values())
      .map((team) => ({
        ...team,
        picks: sortRows(team.picks, teamSort),
      }))
      .sort((a, b) => a.teamName.localeCompare(b.teamName))
  }, [filteredPicks, teamSort])

  const madePicks = picks.filter((p) => p.madePick)
  const skippedPicks = picks.filter((p) => !p.madePick)

  function handleAllSort(columnKey) {
    setAllSort((prev) => ({
      key: columnKey,
      direction:
        prev.key === columnKey && prev.direction === "asc" ? "desc" : "asc",
    }))
  }

  function handleTeamSort(columnKey) {
    setTeamSort((prev) => ({
      key: columnKey,
      direction:
        prev.key === columnKey && prev.direction === "asc" ? "desc" : "asc",
    }))
  }

  return (
    <main style={main}>
      <section style={hero}>
        <div style={eyebrow}>Draft Results</div>
        <h1 style={heroTitle}>{season.label} Draft</h1>
        {loading ? (
          <p style={heroSub}>Loading draft results...</p>
        ) : error ? (
          <p style={heroSub}>{error}</p>
        ) : (
          <p style={heroSub}>
            {draftResults?.draftType || "—"} draft · {draftResults?.draftState || "—"}
          </p>
        )}
      </section>

      {loading ? (
        <div style={loadingBox}>Loading draft data...</div>
      ) : error ? (
        <div style={errorBox}>{error}</div>
      ) : (
  <>
    {season.key === "2018-19" && (
      <div style={noticeBox}>
        The 2018-19 draft comes from a legacy export. Some picks, player identities, or draft order entries may be incomplete or approximate.
      </div>
    )}

    <section style={section}>
      <div style={summaryGrid}>
              <StatCard label="Draft Type" value={draftResults?.draftType || "—"} />
              <StatCard label="Draft State" value={draftResults?.draftState || "—"} />
              <StatCard label="Start Date" value={formatDraftDate(draftResults?.startDate)} />
              <StatCard label="End Date" value={formatDraftDate(draftResults?.endDate)} />
              <StatCard label="Total Picks" value={String(picks.length)} />
              <StatCard label="Made Picks" value={String(madePicks.length)} />
              <StatCard label="Empty Picks" value={String(skippedPicks.length)} />
              <StatCard label="Rounds" value={String(availableRounds.length)} />
            </div>
          </section>

          <section style={section}>
            <div style={sectionTop}>
              <div>
                <h2 style={sectionTitle}>Top Picks</h2>
                <p style={sectionSub}>First 10 picks of the draft.</p>
              </div>
            </div>

            <div style={topPicksGrid}>
              {picks.slice(0, 10).map((pick) => (
                <div key={pick.pick} style={topPickCard}>
                  <div style={topPickNumber}>#{pick.pick}</div>
                  <div style={topPickName}>{pick.playerName}</div>
                  <div style={topPickMeta}>
                    {pick.playerPos || "—"} ·{" "}
                    <TeamLinkCell teamId={pick.teamId} teamName={pick.teamName} />
                  </div>
                  <div style={topPickRound}>
                    Round {pick.round} · Pick {pick.pickInRound}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={section}>
            <div style={sectionTop}>
              <div>
                <h2 style={sectionTitle}>Draft Board</h2>
                <p style={sectionSub}>Switch between the full pick list and grouped team view.</p>
              </div>

              <div style={controlsRow}>
                <label style={filterLabel}>
                  Round{" "}
                  <select
                    value={roundFilter}
                    onChange={(e) => setRoundFilter(e.target.value)}
                    style={filterSelect}
                  >
                    <option value="all">All</option>
                    {availableRounds.map((round) => (
                      <option key={round} value={String(round)}>
                        Round {round}
                      </option>
                    ))}
                  </select>
                </label>

                <div style={toggleWrap}>
                  <button
                    type="button"
                    onClick={() => setViewMode("all")}
                    style={viewMode === "all" ? activeToggleBtn : toggleBtn}
                  >
                    All Picks
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("team")}
                    style={viewMode === "team" ? activeToggleBtn : toggleBtn}
                  >
                    By Team
                  </button>
                </div>
              </div>
            </div>

            {viewMode === "all" ? (
              <div style={tableWrap}>
                <table style={table}>
                  <thead>
                    <tr style={theadRow}>
                      <SortableHeader label="Pick" columnKey="pick" sortConfig={allSort} onSort={handleAllSort} />
                      <SortableHeader label="Round" columnKey="round" sortConfig={allSort} onSort={handleAllSort} />
                      <SortableHeader label="In Round" columnKey="pickInRound" sortConfig={allSort} onSort={handleAllSort} />
                      <SortableHeader label="Player" columnKey="playerName" sortConfig={allSort} onSort={handleAllSort} />
                      <SortableHeader label="Pos" columnKey="playerPos" sortConfig={allSort} onSort={handleAllSort} />
                      <SortableHeader label="ADP" columnKey="playerAdp" sortConfig={allSort} onSort={handleAllSort} />
                      <SortableHeader label="Drafting Team" columnKey="teamName" sortConfig={allSort} onSort={handleAllSort} />
                      <SortableHeader label="Period 17 Team" columnKey="period17Team" sortConfig={allSort} onSort={handleAllSort} />
                      <SortableHeader label="Time" columnKey="time" sortConfig={allSort} onSort={handleAllSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAllPicks.map((pick) => (
                      <tr key={pick.pick}>
                        <td style={td}>#{pick.pick}</td>
                        <td style={td}>{pick.round}</td>
                        <td style={td}>{pick.pickInRound}</td>
                        <td style={td}>
                          <div style={{ fontWeight: 700 }}>
                            {pick.playerName ? (
                              <Link
                                to={`/players/${slugifyPlayerName(pick.playerName)}`}
                                style={teamLink}
                              >
                                {pick.playerName}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </div>
                          {!pick.madePick && (
                            <div style={{ fontSize: 12, color: "#9a3412" }}>
                              No player attached
                            </div>
                          )}
                          {pick.note ? (
                            <div style={{ fontSize: 12, color: "#9a3412", marginTop: 4 }}>
                              {pick.note}
                            </div>
                          ) : null}
                        </td>
                        <td style={td}>{pick.playerPos || "—"}</td>
                        <td style={td}>
                          {typeof pick.playerAdp === "number" ? pick.playerAdp.toFixed(2) : "—"}
                        </td>
                        <td style={td}>
                          <TeamLinkCell teamId={pick.teamId} teamName={pick.teamName} />
                        </td>
                        <td style={td}>
                          <TeamLinkCell
                            teamId={pick.period17TeamId}
                            teamName={pick.period17Team}
                          />
                        </td>
                        <td style={td}>{formatPickTimestamp(pick.time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={teamGroupsGrid}>
                {picksByTeam.map((team) => (
                  <div key={team.teamId} style={teamGroupCard}>
                    <div style={teamGroupHeader}>
                      <div style={teamGroupName}>
                        <TeamLinkCell teamId={team.teamId} teamName={team.teamName} />
                      </div>
                      <div style={teamGroupCount}>{team.picks.length} picks</div>
                    </div>

                    <div style={{ overflowX: "auto" }}>
                      <table style={table}>
                        <thead>
                          <tr style={theadRow}>
                            <SortableHeader label="Pick" columnKey="pick" sortConfig={teamSort} onSort={handleTeamSort} />
                            <SortableHeader label="Round" columnKey="round" sortConfig={teamSort} onSort={handleTeamSort} />
                            <SortableHeader label="Player" columnKey="playerName" sortConfig={teamSort} onSort={handleTeamSort} />
                            <SortableHeader label="Pos" columnKey="playerPos" sortConfig={teamSort} onSort={handleTeamSort} />
                            <SortableHeader label="ADP" columnKey="playerAdp" sortConfig={teamSort} onSort={handleTeamSort} />
                            <SortableHeader label="Period 17 Team" columnKey="period17Team" sortConfig={teamSort} onSort={handleTeamSort} />
                          </tr>
                        </thead>
                        <tbody>
                          {team.picks.map((pick) => (
                            <tr key={`${team.teamId}-${pick.pick}`}>
                              <td style={td}>#{pick.pick}</td>
                              <td style={td}>R{pick.round}.{pick.pickInRound}</td>
                              <td style={td}>
                                <div style={{ fontWeight: 700 }}>
                                  {pick.playerName ? (
                                    <Link
                                      to={`/players/${slugifyPlayerName(pick.playerName)}`}
                                      style={teamLink}
                                    >
                                      {pick.playerName}
                                    </Link>
                                  ) : (
                                    "—"
                                  )}
                                </div>
                                {!pick.madePick && (
                                  <div style={{ fontSize: 12, color: "#9a3412" }}>
                                    No selection
                                  </div>
                                )}
                                {pick.note ? (
                                  <div style={{ fontSize: 12, color: "#9a3412", marginTop: 4 }}>
                                    {pick.note}
                                  </div>
                                ) : null}
                              </td>
                              <td style={td}>{pick.playerPos || "—"}</td>
                              <td style={td}>
                                {typeof pick.playerAdp === "number" ? pick.playerAdp.toFixed(2) : "—"}
                              </td>
                              <td style={td}>
                                <TeamLinkCell
                                  teamId={pick.period17TeamId}
                                  teamName={pick.period17Team}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}

function StatCard({ label, value }) {
  return (
    <div style={statCard}>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value}</div>
    </div>
  )
}

const main = {
  maxWidth: 1240,
  margin: "0 auto",
  padding: "32px 20px 48px",
}

const hero = {
  background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)",
  color: "#ffffff",
  borderRadius: 28,
  padding: "28px 28px 30px",
  marginBottom: 24,
  boxShadow: "0 18px 40px rgba(249,115,22,0.18)",
}

const eyebrow = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  opacity: 0.95,
  marginBottom: 10,
}

const heroTitle = {
  margin: 0,
  fontSize: "clamp(28px, 4vw, 40px)",
  lineHeight: 1.05,
}

const heroSub = {
  margin: "10px 0 0",
  fontSize: 16,
  opacity: 0.95,
}

const section = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 24,
  padding: 24,
  marginBottom: 22,
}

const summaryGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: 14,
}

const statCard = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 18,
}

const statLabel = {
  fontSize: 13,
  fontWeight: 700,
  color: "#9a3412",
}

const statValue = {
  marginTop: 10,
  fontSize: 20,
  fontWeight: 800,
  color: "#111827",
  lineHeight: 1.2,
}

const sectionTop = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  flexWrap: "wrap",
  marginBottom: 18,
}

const sectionTitle = {
  margin: 0,
  fontSize: 24,
  color: "#111827",
}

const sectionSub = {
  margin: "8px 0 0",
  color: "#6b7280",
  fontSize: 15,
}

const controlsRow = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
}

const topPicksGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
}

const topPickCard = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 18,
}

const topPickNumber = {
  color: "#f97316",
  fontWeight: 900,
  fontSize: 14,
  marginBottom: 10,
}

const topPickName = {
  color: "#111827",
  fontWeight: 800,
  fontSize: 18,
  lineHeight: 1.2,
}

const topPickMeta = {
  color: "#6b7280",
  marginTop: 8,
  fontSize: 14,
}

const topPickRound = {
  color: "#9a3412",
  marginTop: 12,
  fontWeight: 700,
  fontSize: 13,
}

const filterLabel = {
  fontWeight: 700,
  color: "#9a3412",
}

const filterSelect = {
  marginLeft: 8,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #fed7aa",
}

const toggleWrap = {
  display: "inline-flex",
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 999,
  padding: 4,
  gap: 4,
}

const toggleBtn = {
  border: "none",
  background: "transparent",
  color: "#9a3412",
  padding: "8px 14px",
  borderRadius: 999,
  fontWeight: 700,
  cursor: "pointer",
}

const activeToggleBtn = {
  ...toggleBtn,
  background: "#f97316",
  color: "#ffffff",
}

const teamGroupsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
  gap: 16,
}

const teamGroupCard = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 18,
}

const teamGroupHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 14,
  flexWrap: "wrap",
}

const teamGroupName = {
  fontSize: 18,
  fontWeight: 800,
}

const teamGroupCount = {
  fontSize: 13,
  fontWeight: 700,
  color: "#9a3412",
}

const tableWrap = {
  overflowX: "auto",
}

const table = {
  width: "100%",
  borderCollapse: "collapse",
}

const theadRow = {
  background: "#fff7ed",
}

const th = {
  textAlign: "left",
  padding: "14px 16px",
  borderBottom: "1px solid #fed7aa",
  color: "#9a3412",
  fontSize: 14,
}

const td = {
  padding: "14px 16px",
  borderBottom: "1px solid #ffedd5",
  fontSize: 14,
  verticalAlign: "top",
}

const sortBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "none",
  background: "transparent",
  color: "#9a3412",
  fontWeight: 700,
  cursor: "pointer",
  padding: 0,
}

const teamLink = {
  color: "#f97316",
  fontWeight: 700,
  textDecoration: "none",
}

const loadingBox = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 24,
}

const errorBox = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 24,
  color: "#9a3412",
}

const noticeBox = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 16,
  marginBottom: 18,
  color: "#9a3412",
  fontSize: 14,
  fontWeight: 600,
}