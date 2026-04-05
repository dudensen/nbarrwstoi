import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useSeason } from "../context/SeasonContext"
import { SEASONS } from "../config/seasons"
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
  getTeamNameMapFromRosters,
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

const LATEST_SEASON =
  SEASONS.find((s) => s.isCurrent) ||
  SEASONS[0]

const PLAYOFFS_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1DEXCIZjzFP6WZUM0LoPP_LVjC1RVFYkTV3gizVxd0ps/export?format=csv&gid=0"

function buildGoogleSheetCsvUrl(sheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
}

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


function isHistoricalSeason(season) {
  return !season?.leagueId
}

function buildChampionMapFromSheet(csvText = "") {
  const matrix = parseCsvMatrix(csvText)
  if (!Array.isArray(matrix) || matrix.length < 2) return new Map()

  const dataRows = matrix.slice(1)
  const rowsByYear = new Map()

  for (const row of dataRows) {
    const year = toNumberOrNull(row?.[0]) // col A
    const phase = normalizeName(row?.[1]) // col B
    const roundLabel = normalizeName(row?.[2]) // col C

    if (!year || phase !== "playoffs" || roundLabel !== "final") continue

    if (!rowsByYear.has(year)) rowsByYear.set(year, [])
    rowsByYear.get(year).push(row)
  }

  const champions = new Map()

  for (const [year, finalRows] of rowsByYear.entries()) {
    const championRow =
      finalRows.find((row) => toNumberOrNull(row?.[6]) === 1) || null // col G

    const runnerUpRow =
      finalRows.find((row) => toNumberOrNull(row?.[6]) === 0) || null // col G

    if (!championRow) continue

    const championTeam = canonicalTeamName(
      decodeMaybeBrokenText(s(championRow?.[4])) // col E
    )

    const runnerUpTeam = canonicalTeamName(
      decodeMaybeBrokenText(s(runnerUpRow?.[4])) // col E
    )

    if (!championTeam) continue

    if (!champions.has(championTeam)) champions.set(championTeam, [])
    champions.get(championTeam).push({
      year,
      season: `${year - 1}-${String(year).slice(-2)}`,
      runnerUp: runnerUpTeam || "—",
    })
  }

  for (const entries of champions.values()) {
    entries.sort((a, b) => b.year - a.year)
  }

  return champions
}

function TrophyCabinetCard({ trophies = [] }) {
  if (!trophies.length) return null

  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 14px" }}>Trophy Cabinet</h3>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {trophies.map((item) => (
          <div
            key={item.year}
            style={{
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              borderRadius: 16,
              padding: 14,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 30, lineHeight: 1 }}>🏆</div>
            <div
              style={{
                fontWeight: 800,
                color: "#111827",
                marginTop: 8,
              }}
            >
              {item.season}
            </div>
            <div style={{ color: "#6b7280", marginTop: 6 }}>
              vs {item.runnerUp}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function parseCsvMatrix(text = "") {
  const rows = []
  let current = []
  let value = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        value += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === "," && !inQuotes) {
      current.push(value)
      value = ""
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") i++
      current.push(value)
      rows.push(current)
      current = []
      value = ""
    } else {
      value += char
    }
  }

  if (value.length || current.length) {
    current.push(value)
    rows.push(current)
  }

  return rows
}

function normalizeFutureSheetPickRows(csvText = "") {
  const matrix = parseCsvMatrix(csvText)
  if (!matrix.length) return []

  const year = String(matrix?.[0]?.[0] || "").trim() || "—"

  const ROUND_BLOCKS = [
    { round: 1, cols: [1, 2, 3] },
    { round: 2, cols: [4, 5, 6] },
    { round: 3, cols: [7, 8, 9] },
  ]

  const dataRows = matrix.slice(2)
  const rows = []

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const row = dataRows[rowIndex] || []

    const originalOwnerRaw = decodeMaybeBrokenText(String(row[0] || "").trim())
    const originalOwner = canonicalTeamName(originalOwnerRaw)
    if (!originalOwner) continue

    for (const block of ROUND_BLOCKS) {
      let currentOwner = ""

      for (let searchRowIndex = 0; searchRowIndex < dataRows.length; searchRowIndex++) {
        const searchRow = dataRows[searchRowIndex] || []

        const candidateOwnerRaw = decodeMaybeBrokenText(
          String(searchRow[0] || "").trim()
        )
        const candidateOwner = canonicalTeamName(candidateOwnerRaw)
        if (!candidateOwner) continue

        const blockValues = block.cols
          .map((colIndex) =>
            canonicalTeamName(
              decodeMaybeBrokenText(String(searchRow[colIndex] || "").trim())
            )
          )
          .filter(Boolean)

        if (blockValues.includes(originalOwner)) {
          currentOwner = candidateOwner
          break
        }
      }

      if (!currentOwner) continue

      rows.push({
        id: `sheet-${year}-${block.round}-${slugifyTeamName(originalOwner)}-${slugifyTeamName(currentOwner)}-${rowIndex}`,
        season: year,
        round: block.round,
        originalOwnerTeamId: "",
        currentOwnerTeamId: "",
        originalOwner,
        currentOwner,
      })
    }
  }

  return rows
}

function getPlayoffRoundRank(label) {
  const text = normalizeName(label)

  if (text.includes("final")) return 400
  if (text.includes("semi")) return 300
  if (text.includes("quarter")) return 200
  if (text.includes("round 1")) return 100
  if (text === "round 1") return 100

  return 0
}

function buildPlayoffRowsFromSheet(csvText, seasonKey, teamSlug, canonicalTeam) {
  const matrix = parseCsvMatrix(csvText)
  if (!matrix.length) return []

  const seasonEndYear = getSeasonEndYear(seasonKey)
  if (!seasonEndYear) return []

  const targetSlug = String(teamSlug || "").trim().toLowerCase()
  const targetCanonicalName = canonicalTeamName(canonicalTeam || "")
  const dataRows = matrix.slice(1)
  const rows = []

  for (let index = 0; index < dataRows.length; index++) {
    const row = dataRows[index] || []

    const year = toNumberOrNull(row[0])
    const phase = normalizeName(row[1])
    if (year !== seasonEndYear) continue
    if (phase !== "playoffs") continue

    const roundLabel = decodeMaybeBrokenText(s(row[2])) || "Playoffs"
    const matchNo = toNumberOrNull(row[3])
    const rowTeam = canonicalTeamName(decodeMaybeBrokenText(s(row[4])))
    if (!rowTeam) continue

    const rowTeamSlug = slugifyTeamName(rowTeam)
    const isTargetTeam =
      (targetSlug && rowTeamSlug === targetSlug) ||
      (targetCanonicalName && rowTeam === targetCanonicalName)

    if (!isTargetTeam) continue

    const gamesWon = toNumberOrNull(row[6])
    const wins = toNumberOrNull(row[7]) ?? 0
    const losses = toNumberOrNull(row[8]) ?? 0
    const ties = toNumberOrNull(row[9]) ?? 0

    const opponentName = canonicalTeamName(
      decodeMaybeBrokenText(s(row[10]).replace(/^vs\s+/i, ""))
    )

    rows.push({
      period: roundLabel,
      sortPeriod: Number.isFinite(matchNo) ? matchNo : 999,
      roundRank: getPlayoffRoundRank(roundLabel),
      matchupId: `playoffs-${seasonEndYear}-${matchNo ?? index}-${rowTeamSlug}`,
      opponentId: "",
      opponentName: opponentName || "—",
      result:
        gamesWon == null ? "T" : gamesWon === 1 ? "W" : gamesWon === 0 ? "L" : "T",
      score: `${wins} - ${losses} - ${ties}`,
      isPlayoff: true,
    })
  }

  return rows.sort((a, b) => {
    if (a.roundRank !== b.roundRank) return b.roundRank - a.roundRank
    if (a.sortPeriod !== b.sortPeriod) return b.sortPeriod - a.sortPeriod
    return String(a.period).localeCompare(String(b.period), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  })
}

function normalizeDraftPickRows(payload, teamIdToName) {
  const futureRows = Array.isArray(payload?.futureDraftPicks)
    ? payload.futureDraftPicks.map((pick, index) => ({
        id: `future-${pick?.year ?? "x"}-${pick?.round ?? "x"}-${pick?.originalOwnerTeamId ?? index}-${pick?.currentOwnerTeamId ?? index}`,
        season: String(pick?.year ?? "—"),
        round: pick?.round ?? "—",
        overall: "—",
        originalOwnerTeamId: String(pick?.originalOwnerTeamId || ""),
        currentOwnerTeamId: String(pick?.currentOwnerTeamId || ""),
        originalOwner:
          teamIdToName.get(String(pick?.originalOwnerTeamId || "")) ||
          pick?.originalOwnerTeamId ||
          "—",
        currentOwner:
          teamIdToName.get(String(pick?.currentOwnerTeamId || "")) ||
          pick?.currentOwnerTeamId ||
          "—",
      }))
    : []

  const currentRows = Array.isArray(payload?.currentDraftPicks)
    ? payload.currentDraftPicks.map((pick, index) => ({
        id: `current-${pick?.round ?? "x"}-${pick?.pick ?? "x"}-${pick?.teamId ?? index}`,
        season: LATEST_SEASON.label,
        round: pick?.round ?? "—",
        overall: pick?.pick ?? "—",
        originalOwnerTeamId: String(pick?.teamId || ""),
        currentOwnerTeamId: String(pick?.teamId || ""),
        originalOwner:
          teamIdToName.get(String(pick?.teamId || "")) ||
          pick?.teamId ||
          "—",
        currentOwner:
          teamIdToName.get(String(pick?.teamId || "")) ||
          pick?.teamId ||
          "—",
      }))
    : []

  return [...currentRows, ...futureRows]
}

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


function normalizeDraftRows(draftResults, teamNameMap, mergedPlayerLookup, seasonKey, seasonLabel) {
  const picks = Array.isArray(draftResults?.draftPicks) ? draftResults.draftPicks : []

  return picks.map((pick) => {
    const player = pick?.playerId ? mergedPlayerLookup.get(String(pick.playerId)) : null
    const playerName = decodeMaybeBrokenText(
      player?.name || (pick?.playerId ? String(pick.playerId) : "No selection")
    )

    const rawAdp = player?.adp ?? player?.ADP ?? null
    const playerAdp =
      typeof rawAdp === "number"
        ? rawAdp
        : Number.isFinite(Number(rawAdp))
        ? Number(rawAdp)
        : null

    return {
      seasonKey,
      seasonLabel,
      teamId: pick?.teamId || null,
      teamName: teamNameMap.get(pick?.teamId) || pick?.teamId || "—",
      playerId: pick?.playerId ? String(pick.playerId) : "",
      playerName,
      playerPos: player?.pos || "",
      playerAdp,
      pick: pick?.pick ?? null,
      round: pick?.round ?? null,
      pickInRound: pick?.pickInRound ?? null,
      time: pick?.time ?? null,
    }
  })
}

function findAdpRowForPlayer(adpRows, player) {
  if (!player) return null

  const playerId = String(player.id || player.playerId || "")
  const playerSlug = slugifyPlayerName(player.name || player.playerName || "")

  return (
    adpRows.find((row) => String(row?.id || row?.playerId || row?.player?.id || "") === playerId) ||
    adpRows.find((row) => slugifyPlayerName(row?.name || row?.playerName || row?.player?.name || "") === playerSlug) ||
    null
  )
}

function BestDraftedPlayerCard({ player }) {
  const currentAdpValue =
    player?.playerAdp ?? player?.adp ?? player?.ADP ?? null

  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 14px" }}>Best Drafted Player</h3>

      {!player ? (
        <div style={{ color: "#6b7280" }}>No drafted player with current ADP found.</div>
      ) : (
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 16,
            padding: 16,
            textAlign: "center",
          }}
        >
          <div
            style={{
              color: "#9a3412",
              fontWeight: 700,
              fontSize: 13,
              marginBottom: 10,
            }}
          >
            {player.seasonLabel || player.seasonKey || "—"}
            {player.pick != null ? ` · #${player.pick}` : ""}
          </div>

          <div
            style={{
              fontSize: 28,
              lineHeight: 1.1,
              fontWeight: 800,
              color: "#111827",
              marginBottom: 10,
            }}
          >
            <PlayerLinkCell playerName={player.playerName || "—"} />
          </div>

          <div
            style={{
              color: "#6b7280",
              fontSize: 13,
            }}
          >
            Current ADP{" "}
            {typeof currentAdpValue === "number"
              ? currentAdpValue.toFixed(2)
              : Number.isFinite(Number(currentAdpValue))
              ? Number(currentAdpValue).toFixed(2)
              : "—"}
          </div>
        </div>
      )}
    </div>
  )
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

function DraftPicksSection({ rows, latestSeasonLabel, countsBySeason }) {
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ margin: 0 }}>Draft Picks</h3>

            {countsBySeason?.length ? (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {countsBySeason.map((item) => (
                  <span
                    key={item.season}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "#fff7ed",
                      border: "1px solid #fed7aa",
                      color: "#9a3412",
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    {item.season}: {item.count}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ color: "#6b7280", marginTop: 6 }}>
            Current and future picks owned by this team ({latestSeasonLabel} league).
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ color: "#6b7280" }}>No draft picks found for this team.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fff7ed" }}>
                <th style={th}>Season</th>
                <th style={th}>Round</th>
                <th style={th}>Original Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((pick) => (
                <tr key={pick.id}>
                  <td style={td}>{pick.season}</td>
                  <td style={td}>{pick.round}</td>
                  <td style={td}>{pick.originalOwner}</td>
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
  trophies,
  teamDraftPicks,
  draftPickCountsBySeason,
  effectiveSeason,
  bestDraftedPlayer,
}) {
    return (
    <main style={main}>
      <Link
        to="/teams"
        style={backLink}
      >
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
            <div style={{ color: "#6b7280" }}>Season: {effectiveSeason.label}</div>
            <div style={{ color: "#6b7280", marginTop: 6 }}>
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

      <div style={topInfoGrid}>
        <TrophyCabinetCard trophies={trophies} />
        <BestDraftedPlayerCard player={bestDraftedPlayer} />
      </div>

      <div style={topInfoGrid}>
        <FranchiseRecordsCard
          historyPayload={historyPayload}
          franchiseRecordRows={franchiseRecordRows}
          franchiseRecordCount={franchiseRecordCount}
        />

        <DraftPicksSection
          rows={teamDraftPicks}
          latestSeasonLabel={LATEST_SEASON.label}
          countsBySeason={draftPickCountsBySeason}
        />
      </div>

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
  const effectiveSeason = season || LATEST_SEASON

  const historicalSeason = isHistoricalSeason(effectiveSeason)

  const [leagueInfo, setLeagueInfo] = useState(null)
  const [latestLeagueInfo, setLatestLeagueInfo] = useState(null)
  const [teamRosters, setTeamRosters] = useState(null)
  const [adpRows, setAdpRows] = useState([])
  const [playerCsvRows, setPlayerCsvRows] = useState([])
  const [matchupResults, setMatchupResults] = useState(null)
  const [transactionsData, setTransactionsData] = useState(null)
  const [historyPayload, setHistoryPayload] = useState(null)
  const [draftPicksData, setDraftPicksData] = useState(null)
  const [extraFuturePickRows, setExtraFuturePickRows] = useState([])
  const [playoffSheetText, setPlayoffSheetText] = useState("")
  const [period, setPeriod] = useState("1")
  const [activeTab, setActiveTab] = useState("results")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [championMap, setChampionMap] = useState(new Map())
  const [allDraftRows, setAllDraftRows] = useState([])

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

        const latestFuturePicksSheetId =
          LATEST_SEASON.spreadsheets?.futurePicksSheetId || ""
        const latestFuturePicksGid =
          LATEST_SEASON.spreadsheets?.futurePicksGid || ""

        const extraFuturePicksUrl =
          latestFuturePicksSheetId && latestFuturePicksGid
            ? buildGoogleSheetCsvUrl(latestFuturePicksSheetId, latestFuturePicksGid)
            : ""

        const adpPromise = fetch(`/api/adp`).then(async (res) => {
          const bodyText = await res.text()
          if (!res.ok) throw new Error(`ADP failed (${res.status}): ${bodyText}`)
          return JSON.parse(bodyText)
        })

        const allCsvPromises = Object.entries(playerCsvFiles).map(async ([path, loader]) => {
          const match = path.match(/\/([^/]+)\.csv$/)
          const seasonKey = match?.[1] || ""
          const csvRows = parsePlayerCsv((await loader()) || "")
          const lookup = buildPlayerLookupFromCsvRows(csvRows)

          return Array.from(lookup.values()).map((player) => ({
            ...player,
            season: seasonKey,
            name: decodeMaybeBrokenText(player?.name || ""),
          }))
        })

        const fantraxSeasonPromises = SEASONS.filter((entry) => entry?.leagueId).map(async (seasonEntry) => {
          const [draftRes, rostersRes] = await Promise.all([
            fetch(`/api/draft-results?season=${encodeURIComponent(seasonEntry.key)}`),
            fetch(`/api/team-rosters?season=${encodeURIComponent(seasonEntry.key)}&period=1`),
          ])

          const [draftText, rostersText] = await Promise.all([
            draftRes.text(),
            rostersRes.text(),
          ])

          if (!draftRes.ok) {
            throw new Error(`Draft results failed for ${seasonEntry.key} (${draftRes.status}): ${draftText}`)
          }
          if (!rostersRes.ok) {
            throw new Error(`Team rosters failed for ${seasonEntry.key} (${rostersRes.status}): ${rostersText}`)
          }

          return {
            seasonKey: seasonEntry.key,
            seasonLabel: seasonEntry.label,
            draftResults: JSON.parse(draftText),
            teamNameMap: getTeamNameMapFromRosters(JSON.parse(rostersText)),
          }
        })

        if (historicalSeason) {
          const [
          historyRes,
          latestLeagueRes,
          draftPicksRes,
          extraFuturePicksRes,
          playoffsRes,
          adpRowsRaw,
          csvGroups,
          seasonDraftData,
        ] = await Promise.all([
          fetch("/data/history-data.json").catch(() => null),
          fetch(`/api/league-info?season=${encodeURIComponent(LATEST_SEASON.key)}`).catch(() => null),
          fetch(`/api/draft-picks?season=${encodeURIComponent(LATEST_SEASON.key)}`),
          extraFuturePicksUrl
            ? fetch(extraFuturePicksUrl).catch(() => null)
            : Promise.resolve(null),
          fetch(PLAYOFFS_SHEET_CSV_URL).catch(() => null),
          adpPromise,
          Promise.all(allCsvPromises),
          Promise.all(fantraxSeasonPromises),
        ])

          const [
            historyText,
            latestLeagueText,
            draftPicksText,
            extraFuturePicksText,
            playoffsText,
          ] = await Promise.all([
            historyRes ? historyRes.text() : Promise.resolve(""),
            latestLeagueRes ? latestLeagueRes.text() : Promise.resolve(""),
            draftPicksRes.text(),
            extraFuturePicksRes ? extraFuturePicksRes.text() : Promise.resolve(""),
            playoffsRes ? playoffsRes.text() : Promise.resolve(""),
          ])

          if (!historyRes || !historyRes.ok) {
            throw new Error(`History data failed (${historyRes?.status || "?"}): ${historyText}`)
          }

          if (!draftPicksRes.ok) {
            throw new Error(`Draft picks failed (${draftPicksRes.status}): ${draftPicksText}`)
          }

          const parsedHistory = JSON.parse(historyText)
          const parsedDraftPicks = JSON.parse(draftPicksText)
          const flatCsvRows = csvGroups.flat()
          const mergedLookup = mergePlayerLookups(
            new Map(
              flatCsvRows.map((row) => [
                String(row.id || row.ID || ""),
                {
                  ...row,
                  id: String(row.id || row.ID || ""),
                  name: decodeMaybeBrokenText(row?.name || row?.Player || ""),
                  pos: row?.pos || row?.Position || "",
                },
              ])
            ),
            buildPlayerLookupFromAdp(Array.isArray(adpRowsRaw) ? adpRowsRaw : [])
          )
          const normalizedAllDraftRows = seasonDraftData.flatMap((seasonBlock) =>
            normalizeDraftRows(
              seasonBlock.draftResults,
              seasonBlock.teamNameMap,
              mergedLookup,
              seasonBlock.seasonKey,
              seasonBlock.seasonLabel
            )
          )
          const parsedExtraFuturePickRows =
            extraFuturePicksRes && extraFuturePicksRes.ok
              ? normalizeFutureSheetPickRows(extraFuturePicksText)
              : []

          if (!cancelled) {
            setLeagueInfo(null)
            setLatestLeagueInfo(
              latestLeagueRes && latestLeagueRes.ok && latestLeagueText
                ? JSON.parse(latestLeagueText)
                : null
            )
            setTeamRosters(null)
            setAdpRows(Array.isArray(adpRowsRaw) ? adpRowsRaw : [])
            setPlayerCsvRows([])
            setAllDraftRows(normalizedAllDraftRows)
            setMatchupResults(null)
            setTransactionsData(null)
            setHistoryPayload(parsedHistory)
            setDraftPicksData(parsedDraftPicks)
            setExtraFuturePickRows(parsedExtraFuturePickRows)
            setPlayoffSheetText(playoffsRes && playoffsRes.ok ? playoffsText : "")
            setChampionMap(
              playoffsRes && playoffsRes.ok ? buildChampionMapFromSheet(playoffsText) : new Map()
            )
          }

          return
        }

        const [
        leagueRes,
        latestLeagueRes,
        rosterRes,
        matchupRes,
        transactionsRes,
        historyRes,
        draftPicksRes,
        extraFuturePicksRes,
        playoffsRes,
        csvText,
        adpRowsRaw,
        csvGroups,
        seasonDraftData,
      ] = await Promise.all([
        fetch(`/api/league-info?season=${encodeURIComponent(effectiveSeason.key)}`),
        fetch(`/api/league-info?season=${encodeURIComponent(LATEST_SEASON.key)}`).catch(() => null),
        fetch(
          `/api/team-rosters?season=${encodeURIComponent(
            effectiveSeason.key
          )}&period=${encodeURIComponent(period)}`
        ),
        fetch(matchupFile),
        fetch(transactionsFile).catch(() => null),
        fetch("/data/history-data.json").catch(() => null),
        fetch(`/api/draft-picks?season=${encodeURIComponent(LATEST_SEASON.key)}`),
        extraFuturePicksUrl
          ? fetch(extraFuturePicksUrl).catch(() => null)
          : Promise.resolve(null),
        fetch(PLAYOFFS_SHEET_CSV_URL).catch(() => null),
        csvLoader ? csvLoader() : Promise.resolve(""),
        adpPromise,
        Promise.all(allCsvPromises),
        Promise.all(fantraxSeasonPromises),
      ])

        const [
        leagueText,
        latestLeagueText,
        rosterText,
        matchupText,
        transactionsText,
        historyText,
        draftPicksText,
        extraFuturePicksText,
        playoffsText,
      ] = await Promise.all([
        leagueRes.text(),
        latestLeagueRes ? latestLeagueRes.text() : Promise.resolve(""),
        rosterRes.text(),
        matchupRes.text(),
        transactionsRes ? transactionsRes.text() : Promise.resolve(""),
        historyRes ? historyRes.text() : Promise.resolve(""),
        draftPicksRes.text(),
        extraFuturePicksRes ? extraFuturePicksRes.text() : Promise.resolve(""),
        playoffsRes ? playoffsRes.text() : Promise.resolve(""),
      ])

        if (!leagueRes.ok) {
          throw new Error(`League info failed (${leagueRes.status}): ${leagueText}`)
          
        }
        if (!rosterRes.ok) {
          throw new Error(`Team rosters failed (${rosterRes.status}): ${rosterText}`)
        }
        if (!matchupRes.ok) {
          throw new Error(
            `Matchup results failed (${matchupRes.status}): ${matchupText}`
          )
        }
        if (!draftPicksRes.ok) {
          throw new Error(`Draft picks failed (${draftPicksRes.status}): ${draftPicksText}`)
        }

        let parsedTransactions = null
        if (transactionsRes && transactionsRes.ok && transactionsText) {
          parsedTransactions = JSON.parse(transactionsText)
        }

        let parsedHistory = null
        if (historyRes && historyRes.ok && historyText) {
          parsedHistory = JSON.parse(historyText)
        }

        let parsedDraftPicks = null
        try {
          parsedDraftPicks = JSON.parse(draftPicksText)
        } catch {
          throw new Error(
            `Draft picks did not return JSON. Response starts with: ${draftPicksText.slice(0, 120)}`
          )
        }

        const nextChampionMap =
          playoffsRes && playoffsRes.ok ? buildChampionMapFromSheet(playoffsText) : new Map()

        const flatCsvRows = csvGroups.flat()
        const currentAdpRows = Array.isArray(adpRowsRaw) ? adpRowsRaw : []
        const mergedLookup = mergePlayerLookups(
          new Map(
            flatCsvRows.map((row) => [
              String(row.id || row.ID || ""),
              {
                ...row,
                id: String(row.id || row.ID || ""),
                name: decodeMaybeBrokenText(row?.name || row?.Player || ""),
                pos: row?.pos || row?.Position || "",
              },
            ])
          ),
          buildPlayerLookupFromAdp(currentAdpRows)
        )
        const normalizedAllDraftRows = seasonDraftData.flatMap((seasonBlock) =>
          normalizeDraftRows(
            seasonBlock.draftResults,
            seasonBlock.teamNameMap,
            mergedLookup,
            seasonBlock.seasonKey,
            seasonBlock.seasonLabel
          )
        )

        const parsedExtraFuturePickRows =
          extraFuturePicksRes && extraFuturePicksRes.ok && extraFuturePicksText
            ? normalizeFutureSheetPickRows(extraFuturePicksText)
            : []

        if (!cancelled) {
          setLeagueInfo(JSON.parse(leagueText))
          setTeamRosters(JSON.parse(rosterText))
          setAdpRows(currentAdpRows)
          setPlayerCsvRows(parsePlayerCsv(csvText || ""))
          setAllDraftRows(normalizedAllDraftRows)
          setMatchupResults(JSON.parse(matchupText))
          setTransactionsData(parsedTransactions)
          setHistoryPayload(parsedHistory)
          setDraftPicksData(parsedDraftPicks)
          setExtraFuturePickRows(parsedExtraFuturePickRows)
          setPlayoffSheetText(playoffsRes && playoffsRes.ok ? playoffsText : "")
          setChampionMap(nextChampionMap)
          setLatestLeagueInfo(
            latestLeagueRes && latestLeagueRes.ok && latestLeagueText
              ? JSON.parse(latestLeagueText)
              : null
          )
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setLeagueInfo(null)
          setLatestLeagueInfo(null)
          setTeamRosters(null)
          setAdpRows([])
          setPlayerCsvRows([])
          setMatchupResults(null)
          setTransactionsData(null)
          setHistoryPayload(null)
          setDraftPicksData(null)
          setExtraFuturePickRows([])
          setPlayoffSheetText("")
          setChampionMap(new Map())
          setAllDraftRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [effectiveSeason.key, historicalSeason, period])

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

  const teamTrophies = useMemo(() => {
  return championMap.get(canonicalTeam) || []
}, [championMap, canonicalTeam])

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

  const teamIdToName = useMemo(() => {
  const map = new Map()

  for (const candidate of extractTeamsFromLeagueInfoSafe(latestLeagueInfo || {})) {
    map.set(
      String(candidate.id),
      canonicalTeamName(decodeMaybeBrokenText(candidate.name || ""))
    )
  }

  return map
}, [latestLeagueInfo])

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

  const regularMatchupRows = useMemo(() => {
    const rows = []

    for (const matchup of matchupResults?.matchups || []) {
      const teams = Array.isArray(matchup?.teams) ? matchup.teams : []
      const mine = teams.find((t) => String(t?.id) === String(teamId))
      if (!mine) continue

      const opponent = teams.find((t) => String(t?.id) !== String(teamId)) || null
      const isWinner = String(matchup?.winnerTeamId || "") === String(teamId)

      rows.push({
        period: matchup.period,
        sortPeriod: Number(matchup.period) || 0,
        matchupId: matchup.matchupId,
        opponentId: opponent?.id || "",
        opponentName: decodeMaybeBrokenText(opponent?.name || "—"),
        result:
          matchup?.winnerTeamId == null ? "T" : isWinner ? "W" : "L",
        score: formatScoreText(matchup?.scoreText),
        isPlayoff: false,
      })
    }

    return rows.sort((a, b) => a.sortPeriod - b.sortPeriod)
  }, [matchupResults, teamId])

  const playoffMatchupRows = useMemo(() => {
    return buildPlayoffRowsFromSheet(
      playoffSheetText,
      effectiveSeason.key,
      teamSlug,
      canonicalTeam
    )
  }, [playoffSheetText, effectiveSeason.key, teamSlug, canonicalTeam])

  const matchupRows = useMemo(() => {
  return [...regularMatchupRows, ...playoffMatchupRows].sort((a, b) => {
    const aPlayoff = Boolean(a.isPlayoff)
    const bPlayoff = Boolean(b.isPlayoff)

    if (aPlayoff && !bPlayoff) return -1
    if (!aPlayoff && bPlayoff) return 1

    if (aPlayoff && bPlayoff) {
      if ((a.roundRank || 0) !== (b.roundRank || 0)) {
        return (b.roundRank || 0) - (a.roundRank || 0)
      }
      return (b.sortPeriod || 0) - (a.sortPeriod || 0)
    }

    return (Number(b.sortPeriod) || 0) - (Number(a.sortPeriod) || 0)
  })
}, [regularMatchupRows, playoffMatchupRows])

  const completedPeriods = useMemo(
    () =>
      new Set(
        regularMatchupRows
          .map((row) => Number(row.period))
          .filter((value) => Number.isFinite(value))
      ),
    [regularMatchupRows]
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

  const teamDraftPicks = useMemo(() => {
    const targetTeamId = String(teamId || "")
    const targetTeamName = canonicalTeamName(canonicalTeam || "")

    const fantraxRows = normalizeDraftPickRows(draftPicksData, teamIdToName)
    const allRows = [...fantraxRows, ...extraFuturePickRows]

    return allRows
      .filter((pick) => {
        const byId =
          targetTeamId && String(pick.currentOwnerTeamId || "") === targetTeamId

        const byName =
          canonicalTeamName(decodeMaybeBrokenText(pick.currentOwner || "")) ===
          targetTeamName

        return byId || byName
      })
      .sort((a, b) => {
        const seasonCompare = String(a.season).localeCompare(String(b.season), undefined, {
          numeric: true,
          sensitivity: "base",
        })
        if (seasonCompare !== 0) return seasonCompare

        const roundA = Number(a.round)
        const roundB = Number(b.round)
        if (Number.isFinite(roundA) && Number.isFinite(roundB) && roundA !== roundB) {
          return roundA - roundB
        }

        const overallA = Number(a.overall)
        const overallB = Number(b.overall)
        if (Number.isFinite(overallA) && Number.isFinite(overallB)) {
          return overallA - overallB
        }

        return String(a.originalOwner).localeCompare(String(b.originalOwner), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      })
  }, [draftPicksData, extraFuturePickRows, teamIdToName, teamId, canonicalTeam])

  const draftPickCountsBySeason = useMemo(() => {
    const counts = new Map()

    for (const pick of teamDraftPicks) {
      const seasonKey = String(pick.season || "—")
      counts.set(seasonKey, (counts.get(seasonKey) || 0) + 1)
    }

    return Array.from(counts.entries())
      .sort((a, b) =>
        String(a[0]).localeCompare(String(b[0]), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      )
      .map(([seasonKey, count]) => ({
        season: seasonKey,
        count,
      }))
  }, [teamDraftPicks])

  const bestDraftedPlayer = useMemo(() => {
    if (!canonicalTeam) return null

    const targetTeam = canonicalTeamName(canonicalTeam)
    const seenPlayers = new Set()

    const draftedRows = allDraftRows
      .filter((row) => canonicalTeamName(row.teamName) === targetTeam)
      .sort((a, b) => {
        const seasonCompare = String(a.seasonKey || "").localeCompare(String(b.seasonKey || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        })
        if (seasonCompare !== 0) return seasonCompare

        const pickA = Number(a.pick)
        const pickB = Number(b.pick)
        if (Number.isFinite(pickA) && Number.isFinite(pickB) && pickA !== pickB) {
          return pickA - pickB
        }

        return String(a.playerName || "").localeCompare(String(b.playerName || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      })
      .filter((row) => row.playerId || row.playerName)
      .filter((row) => {
        const key = String(row.playerId || slugifyPlayerName(row.playerName || ""))
        if (!key || seenPlayers.has(key)) return false
        seenPlayers.add(key)
        return true
      })
      .map((row) => {
        const adpRow = findAdpRowForPlayer(adpRows, {
          id: row.playerId,
          name: row.playerName,
        })
        const currentAdp = Number(adpRow?.ADP ?? adpRow?.adp)

        return {
          ...row,
          currentAdp: Number.isFinite(currentAdp) ? currentAdp : null,
        }
      })
      .filter((row) => typeof row.currentAdp === "number")
      .sort((a, b) => a.currentAdp - b.currentAdp)

    return draftedRows[0] || null
  }, [allDraftRows, adpRows, canonicalTeam])

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
      trophies={teamTrophies}
      teamDraftPicks={teamDraftPicks}
      draftPickCountsBySeason={draftPickCountsBySeason}
      effectiveSeason={effectiveSeason}
      bestDraftedPlayer={bestDraftedPlayer}
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

      <>
  <div style={topInfoGrid}>
    <TrophyCabinetCard trophies={teamTrophies} />
    <BestDraftedPlayerCard player={bestDraftedPlayer} />
  </div>

  <div style={topInfoGrid}>
    <FranchiseRecordsCard
      historyPayload={historyPayload}
      franchiseRecordRows={franchiseRecordRows}
      franchiseRecordCount={franchiseRecordCount}
    />

    <DraftPicksSection
      rows={teamDraftPicks}
      latestSeasonLabel={LATEST_SEASON.label}
      countsBySeason={draftPickCountsBySeason}
    />
  </div>
</>

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
                    <th style={th}>Period / Round</th>
                    <th style={th}>Opponent</th>
                    <th style={th}>Result</th>
                    <th style={th}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {matchupRows.map((row) => (
                    <tr key={`${row.period}-${row.matchupId}-${row.opponentName}`}>
                      <td style={td}>{row.period}</td>
                      <td style={td}>
                        {row.opponentName && row.opponentName !== "—" ? (
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

const topInfoGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
  gap: 16,
  alignItems: "start",
}