import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  buildPlayerLookupFromAdp,
  buildPlayerLookupFromCsvRows,
  parsePlayerCsv,
  mergePlayerLookups,
  getTeamNameMapFromRosters,
  slugifyTeamName,
  decodeMaybeBrokenText,
} from "../utils/fantrax"
import { SEASONS } from "../config/seasons"

const LATEST_SEASON =
  SEASONS.find((s) => s.isCurrent) ||
  SEASONS[0]

const playerCsvFiles = import.meta.glob("../config/playerCsv/*.csv", {
  query: "?raw",
  import: "default",
})

function slugifyPlayerName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
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

function formatTransactionDate(value) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function normalizeNameLoose(value) {
  return String(decodeMaybeBrokenText(value) || "")
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeIdLoose(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\*+|\*+$/g, "")
    .toLowerCase()
}

function transactionPlayerMatches(playerRow, player) {
  if (!playerRow || !player) return false

  const playerId = normalizeIdLoose(player.id)
  const targetA = normalizeNameLoose(player.name)
  const targetB = targetA.split(" ").reverse().join(" ").trim()

  const rowId = normalizeIdLoose(playerRow.id || playerRow.playerId)
  const rowName = normalizeNameLoose(
    playerRow.name ||
      playerRow.playerName ||
      playerRow.short_name ||
      ""
  )

  return rowId === playerId || rowName === targetA || rowName === targetB
}

function normalizeTransactionRows(raw, player, seasonKey) {
  const rows = Array.isArray(raw?.transactions)
    ? raw.transactions
    : Array.isArray(raw)
    ? raw
    : []

  return rows
    .map((tx) => {
      const matchedPlayers = Array.isArray(tx?.players)
        ? tx.players.filter((p) => transactionPlayerMatches(p, player))
        : []

      return {
        id: tx?.id || `${seasonKey}-${tx?.date || Math.random()}`,
        season: seasonKey,
        date: tx?.date || "—",
        types: Array.isArray(tx?.types) ? tx.types : [],
        teamId: tx?.team?.id || null,
        teamName: decodeMaybeBrokenText(tx?.team?.name || "—"),
        matchedPlayers,
      }
    })
    .filter((tx) => tx.matchedPlayers.length > 0)
}

function sortTransactionsDesc(rows) {
  return [...rows].sort((a, b) => {
    const aTime = new Date(a?.date || 0).getTime()
    const bTime = new Date(b?.date || 0).getTime()
    return bTime - aTime
  })
}

function formatDateTime(value) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function splitName(fullName) {
  const clean = String(fullName ?? "").trim()
  if (!clean) return { firstName: "—", lastName: "—" }

  if (clean.includes(",")) {
    const [last, first] = clean.split(",").map((x) => x.trim())
    return {
      firstName: first || "—",
      lastName: last || "—",
    }
  }

  const parts = clean.split(/\s+/)
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "—" }
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.slice(-1).join(""),
  }
}

function compareSeasonKeysAsc(a, b) {
  const ay = Number(String(a || "").slice(0, 4))
  const by = Number(String(b || "").slice(0, 4))
  return ay - by
}

function getPlayerNameFromAnyRow(row) {
  const raw =
    row?.name ||
    row?.playerName ||
    row?.fullName ||
    row?.Player ||
    row?.player?.name ||
    [row?.firstName, row?.lastName].filter(Boolean).join(" ") ||
    [row?.first_name, row?.last_name].filter(Boolean).join(" ") ||
    ""

  return decodeMaybeBrokenText(raw)
}

function getPlayerPosFromAnyRow(row) {
  return (
    row?.pos ||
    row?.position ||
    row?.Position ||
    row?.player?.pos ||
    row?.player?.position ||
    ""
  )
}

function findPlayerInRowsBySlug(rows, playerSlug) {
  for (const row of rows) {
    const name = getPlayerNameFromAnyRow(row)
    if (slugifyPlayerName(name) === playerSlug) {
      return row
    }
  }
  return null
}

function findPlayerBySlug(playerSlug, currentAdpRows, historicalCsvRows, allDraftRows) {
  const adpMatch = findPlayerInRowsBySlug(currentAdpRows, playerSlug)
  if (adpMatch) {
    return {
      source: "adp",
      id: String(adpMatch.id || adpMatch.playerId || adpMatch.player?.id || ""),
      name: getPlayerNameFromAnyRow(adpMatch) || "Unknown Player",
      pos: getPlayerPosFromAnyRow(adpMatch),
      adp: adpMatch.ADP ?? adpMatch.adp ?? null,
      retired: false,
      raw: adpMatch,
    }
  }

  const csvMatch = findPlayerInRowsBySlug(historicalCsvRows, playerSlug)
  if (csvMatch) {
    return {
      source: "csv",
      id: String(csvMatch.id || csvMatch.ID || ""),
      name: getPlayerNameFromAnyRow(csvMatch) || "Unknown Player",
      pos: getPlayerPosFromAnyRow(csvMatch),
      adp: null,
      retired: true,
      raw: csvMatch,
    }
  }

  const draftMatch = allDraftRows.find(
    (row) => slugifyPlayerName(row.playerName) === playerSlug
  )
  if (draftMatch) {
    return {
      source: "draft",
      id: String(draftMatch.playerId || ""),
      name: draftMatch.playerName || "Unknown Player",
      pos: draftMatch.playerPos || "",
      adp: null,
      retired: true,
      raw: draftMatch,
    }
  }

  return null
}

function findCurrentRosterSpot(teamRostersResponse, player) {
  if (!player) return null

  const playerId = String(player.id || "").trim()
  const playerSlug = slugifyPlayerName(player.name || "")
  const rosters = teamRostersResponse?.rosters || {}

  for (const [teamId, teamData] of Object.entries(rosters)) {
    const rosterItems = teamData?.rosterItems || []

    for (const item of rosterItems) {
      const itemId = String(item?.id || "").trim()
      const itemName =
        decodeMaybeBrokenText(
          item?.playerName ||
            item?.name ||
            item?.player?.name ||
            ""
        ) || ""

      const sameId = playerId && itemId && itemId === playerId
      const sameSlug = itemName && slugifyPlayerName(itemName) === playerSlug

      if (sameId || sameSlug) {
        return {
          teamId,
          teamName: teamData?.teamName || teamId,
          status: item?.status || "—",
          slot: item?.position || "—",
          raw: item,
        }
      }
    }
  }

  return null
}

function normalizeDraftRows(draftResults, teamNameMap, mergedPlayerLookup, seasonKey, seasonLabel) {
  const picks = Array.isArray(draftResults?.draftPicks) ? draftResults.draftPicks : []

  return picks.map((pick) => {
    const player = pick?.playerId ? mergedPlayerLookup.get(String(pick.playerId)) : null
    const playerName = decodeMaybeBrokenText(
      player?.name || (pick?.playerId ? String(pick.playerId) : "No selection")
    )

    return {
      seasonKey,
      seasonLabel,
      teamId: pick?.teamId || null,
      teamName: teamNameMap.get(pick?.teamId) || pick?.teamId || "—",
      playerId: pick?.playerId ? String(pick.playerId) : "",
      playerName,
      playerPos: player?.pos || "",
      pick: pick?.pick ?? null,
      round: pick?.round ?? null,
      pickInRound: pick?.pickInRound ?? null,
      time: pick?.time ?? null,
    }
  })
}

function findAdpRowForPlayer(adpRows, player) {
  if (!player) return null

  const playerId = String(player.id || "")
  const playerSlug = slugifyPlayerName(player.name || "")

  return (
    adpRows.find((row) => String(row?.id || row?.playerId || row?.player?.id || "") === playerId) ||
    adpRows.find((row) => slugifyPlayerName(getPlayerNameFromAnyRow(row)) === playerSlug) ||
    null
  )
}

function TeamLinkCell({ teamId, teamName, seasonKey }) {
  if (!teamName) return <span>—</span>

  if (!teamId || teamName === "Free Agent" || teamName === "Retired") {
    return <span>{teamName}</span>
  }

  const href = seasonKey
    ? `/teams/${slugifyTeamName(teamName)}?season=${encodeURIComponent(seasonKey)}`
    : `/teams/${slugifyTeamName(teamName)}`

  return (
    <Link to={href} style={teamLink}>
      {teamName}
    </Link>
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

function DetailRow({ label, value }) {
  return (
    <div style={detailRow}>
      <div style={detailLabel}>{label}</div>
      <div style={detailValue}>{value}</div>
    </div>
  )
}

export default function PlayerDetailPage() {
  const { playerSlug } = useParams()

  const [currentAdpRows, setCurrentAdpRows] = useState([])
  const [historicalCsvRows, setHistoricalCsvRows] = useState([])
  const [allDraftRows, setAllDraftRows] = useState([])
  const [currentSeasonRosters, setCurrentSeasonRosters] = useState(null)
  const [careerRows, setCareerRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        const adpPromise = fetch(`/api/adp`).then(async (res) => {
          const text = await res.text()
          if (!res.ok) throw new Error(`ADP failed (${res.status}): ${text}`)
          return JSON.parse(text)
        })

        const currentRostersPromise = fetch(
          `/api/team-rosters?season=${encodeURIComponent(LATEST_SEASON.key)}&period=1`
        ).then(async (res) => {
          const text = await res.text()
          if (!res.ok) throw new Error(`Current season rosters failed (${res.status}): ${text}`)
          return JSON.parse(text)
        })

        const csvPromises = Object.entries(playerCsvFiles).map(async ([path, loader]) => {
          const match = path.match(/\/([^/]+)\.csv$/)
          const seasonKey = match?.[1] || ""
          const text = await loader()
          const rows = parsePlayerCsv(text || "")
          const lookup = buildPlayerLookupFromCsvRows(rows)

          return Array.from(lookup.values()).map((player) => ({
            ...player,
            season: seasonKey,
            name: decodeMaybeBrokenText(player?.name || ""),
          }))
        })

        const seasonPromises = SEASONS.map(async (seasonEntry) => {
          const [draftRes, rostersRes, transactionsRes] = await Promise.all([
            fetch(`/api/draft-results?season=${encodeURIComponent(seasonEntry.key)}`),
            fetch(`/api/team-rosters?season=${encodeURIComponent(seasonEntry.key)}&period=1`),
            fetch(`/data/transactions-${encodeURIComponent(seasonEntry.key)}.json`),
          ])

          const [draftText, rostersText, transactionsText] = await Promise.all([
            draftRes.text(),
            rostersRes.text(),
            transactionsRes.text(),
          ])

          if (!draftRes.ok) {
            throw new Error(`Draft results failed for ${seasonEntry.key} (${draftRes.status}): ${draftText}`)
          }
          if (!rostersRes.ok) {
            throw new Error(`Team rosters failed for ${seasonEntry.key} (${rostersRes.status}): ${rostersText}`)
          }

          const draftResults = JSON.parse(draftText)
          const rosters = JSON.parse(rostersText)
          const teamNameMap = getTeamNameMapFromRosters(rosters)

          let transactionsJson = []
          if (transactionsRes.ok && String(transactionsText || "").trim()) {
            try {
              transactionsJson = JSON.parse(transactionsText)
            } catch {
              transactionsJson = []
            }
          }

          return {
            seasonKey: seasonEntry.key,
            seasonLabel: seasonEntry.label,
            draftResults,
            teamNameMap,
            transactionsJson,
          }
        })

        const [adpRowsRaw, currentRosters, csvGroups, seasonData] = await Promise.all([
          adpPromise,
          currentRostersPromise,
          Promise.all(csvPromises),
          Promise.all(seasonPromises),
        ])

        const adpRows = Array.isArray(adpRowsRaw) ? adpRowsRaw : []
        const flatCsvRows = csvGroups.flat()

        const adpLookup = buildPlayerLookupFromAdp(adpRows)
        const csvLookup = new Map(
          flatCsvRows.map((row) => [
            String(row.id || row.ID || ""),
            {
              ...row,
              id: String(row.id || row.ID || ""),
              name: decodeMaybeBrokenText(row?.name || row?.Player || ""),
              pos: row?.pos || row?.Position || "",
            },
          ])
        )

        const mergedLookup = mergePlayerLookups(csvLookup, adpLookup)

        const draftRows = seasonData.flatMap((seasonBlock) =>
          normalizeDraftRows(
            seasonBlock.draftResults,
            seasonBlock.teamNameMap,
            mergedLookup,
            seasonBlock.seasonKey,
            seasonBlock.seasonLabel
          )
        )

        const resolvedPlayer = findPlayerBySlug(
          playerSlug,
          adpRows,
          flatCsvRows,
          draftRows
        )

        if (!resolvedPlayer) {
          throw new Error("Player not found.")
        }

        const normalizedCareer = sortTransactionsDesc(
          seasonData.flatMap((seasonBlock) =>
            normalizeTransactionRows(
              seasonBlock.transactionsJson,
              resolvedPlayer,
              seasonBlock.seasonKey
            )
          )
        )

        if (!cancelled) {
          setCurrentAdpRows(adpRows)
          setHistoricalCsvRows(flatCsvRows)
          setAllDraftRows(draftRows)
          setCurrentSeasonRosters(currentRosters)
          setCareerRows(normalizedCareer)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setCurrentAdpRows([])
          setHistoricalCsvRows([])
          setAllDraftRows([])
          setCurrentSeasonRosters(null)
          setCareerRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [playerSlug])

  const player = useMemo(() => {
    return findPlayerBySlug(playerSlug, currentAdpRows, historicalCsvRows, allDraftRows)
  }, [playerSlug, currentAdpRows, historicalCsvRows, allDraftRows])

  const nameParts = useMemo(() => splitName(player?.name || ""), [player])

  const currentAdpRow = useMemo(() => {
    return findAdpRowForPlayer(currentAdpRows, player)
  }, [currentAdpRows, player])

  const currentAdpValue = useMemo(() => {
    const value = currentAdpRow?.ADP ?? currentAdpRow?.adp ?? player?.adp ?? null
    return typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : null
  }, [currentAdpRow, player])

  const currentRosterSpot = useMemo(() => {
    return findCurrentRosterSpot(currentSeasonRosters, player)
  }, [currentSeasonRosters, player])

  const currentFantasyTeam = useMemo(() => {
    if (!player) return "—"
    if (currentRosterSpot?.teamName) return currentRosterSpot.teamName
    if (player.retired) return "Retired"
    return "Free Agent"
  }, [player, currentRosterSpot])

  const originalDraft = useMemo(() => {
    if (!player) return null

    const matches = allDraftRows
      .filter((row) => {
        const byId = player.id && String(row.playerId) === String(player.id)
        const bySlug = slugifyPlayerName(row.playerName) === slugifyPlayerName(player.name)
        return byId || bySlug
      })
      .sort((a, b) => {
        const seasonCompare = compareSeasonKeysAsc(a.seasonKey, b.seasonKey)
        if (seasonCompare !== 0) return seasonCompare

        const aPick = Number(a.pick ?? Number.POSITIVE_INFINITY)
        const bPick = Number(b.pick ?? Number.POSITIVE_INFINITY)
        return aPick - bPick
      })

    return matches[0] || null
  }, [player, allDraftRows])

  const earliestTrackedSeason = SEASONS[SEASONS.length - 1]?.label || "2020-21"

  const draftInfoUnavailable = !originalDraft && Boolean(player)

  const draftedSeasonText = originalDraft
    ? originalDraft.seasonLabel
    : draftInfoUnavailable
    ? `Data not available (before ${earliestTrackedSeason})`
    : "—"

  const draftedByText = originalDraft
    ? null
    : draftInfoUnavailable
    ? `Data not available (before ${earliestTrackedSeason})`
    : "—"

  if (loading) {
    return (
      <main style={main}>
        <div style={card}>Loading player profile...</div>
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

  if (!player) {
    return (
      <main style={main}>
        <div style={errorBox}>Player not found.</div>
      </main>
    )
  }

  return (
    <main style={main}>
      <Link to="/draft-results" style={backLink}>
        ← Back to draft results
      </Link>

      <section style={hero}>
        <div style={eyebrow}>Player Profile</div>
        <h1 style={heroTitle}>{player.name}</h1>
        <p style={heroSub}>
          {player.pos || "—"} · ID {player.id || "—"}
        </p>
      </section>

      <section style={section}>
        <div style={summaryGrid}>
          <StatCard label="First Name" value={nameParts.firstName} />
          <StatCard label="Last Name" value={nameParts.lastName} />
          <StatCard label="Position" value={player.pos || "—"} />
          <StatCard
            label="ADP"
            value={typeof currentAdpValue === "number" ? currentAdpValue.toFixed(2) : "—"}
          />
          <StatCard label="Current Team" value={currentFantasyTeam} />
        </div>
      </section>

      <section style={section}>
        <div style={sectionTop}>
          <div>
            <h2 style={sectionTitle}>Draft Info</h2>
            <p style={sectionSub}>Original draft information.</p>
          </div>
        </div>

        <div style={detailGrid}>
          <DetailRow
            label="Season Drafted"
            value={draftedSeasonText}
          />
          <DetailRow
            label="Drafted By"
            value={
              originalDraft ? (
                <TeamLinkCell
                  teamId={originalDraft.teamId}
                  teamName={originalDraft.teamName}
                  seasonKey={originalDraft.seasonKey}
                />
              ) : (
                draftedByText
              )
            }
          />
          <DetailRow
            label="Overall Pick"
            value={originalDraft?.pick != null ? `#${originalDraft.pick}` : "—"}
          />
          <DetailRow label="Current Team" value={currentFantasyTeam} />
          <DetailRow label="Round" value={originalDraft?.round ?? "—"} />
          <DetailRow
            label="Pick in Round"
            value={originalDraft?.pickInRound ?? "—"}
          />
          <DetailRow
            label="Draft Time"
            value={formatDateTime(originalDraft?.time)}
          />
        </div>
      </section>

      <section style={section}>
        <div style={sectionTop}>
          <div>
            <h2 style={sectionTitle}>League Career</h2>
            <p style={sectionSub}>
              All transactions involving this player across all seasons.
            </p>
          </div>
        </div>

        {careerRows.length === 0 ? (
          <div style={emptyBox}>No transactions found for this player.</div>
        ) : (
          <div style={transactionsList}>
            {careerRows.map((tx) => (
              <div key={`${tx.season}-${tx.id}`} style={transactionCard}>
                <div style={transactionHeader}>
                  <div>
                    <div style={transactionDate}>{formatTransactionDate(tx.date)}</div>
                    <div style={transactionTypes}>
                      {tx.season} · {transactionTypeLabel(tx.types)}
                    </div>
                  </div>
                  <div style={transactionTeam}>
                    {tx.teamId ? (
                      <TeamLinkCell
                        teamId={tx.teamId}
                        teamName={tx.teamName}
                        seasonKey={tx.season}
                      />
                    ) : (
                      tx.teamName
                    )}
                  </div>
                </div>

                <div style={transactionPlayers}>
                  {tx.matchedPlayers.map((p, idx) => (
                    <div key={`${tx.id}-${p.id || idx}-${p.type || "x"}`} style={transactionPlayerRow}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span
                          style={{
                            ...playerTypeBadge,
                            color: playerTypeColor(p.type),
                            borderColor: playerTypeColor(p.type),
                          }}
                        >
                          {p.type || "—"}
                        </span>
                        <span style={transactionPlayerName}>
                          {decodeMaybeBrokenText(p.name || p.playerName || "—")}
                        </span>
                        <span style={transactionPlayerMeta}>
                          {p.pos_short_name || "—"} · {decodeMaybeBrokenText(p.team_name || "—")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
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

const card = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 24,
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
  wordBreak: "break-word",
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

const detailGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 14,
}

const detailRow = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 18,
  padding: 16,
}

const detailLabel = {
  fontSize: 13,
  fontWeight: 700,
  color: "#9a3412",
  marginBottom: 8,
}

const detailValue = {
  fontSize: 17,
  fontWeight: 700,
  color: "#111827",
  wordBreak: "break-word",
}

const backLink = {
  display: "inline-block",
  marginBottom: 16,
  color: "#f97316",
  textDecoration: "none",
  fontWeight: 600,
}

const teamLink = {
  color: "#f97316",
  fontWeight: 700,
  textDecoration: "none",
}

const emptyBox = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 18,
  padding: 18,
  color: "#6b7280",
}

const errorBox = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 24,
  color: "#9a3412",
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

const transactionPlayerName = {
  color: "#111827",
  fontWeight: 700,
}

const transactionPlayerMeta = {
  color: "#6b7280",
  fontSize: 14,
}