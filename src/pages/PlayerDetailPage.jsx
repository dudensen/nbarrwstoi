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
import { canonicalTeamName } from "../utils/history"
import { HISTORICAL_DRAFT_RESULTS } from "../config/historicalDraftResults"

import {
  CONTRACTS_CSV_URL,
  parseContractsCsv,
  normalizeContractPlayerName,
} from "../utils/contracts"

const LATEST_SEASON =
  SEASONS.find((s) => s.isCurrent) ||
  SEASONS[0]

const HISTORICAL_TRADES_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRbbhrj0UcAR4RG2zZgLxshUbsJy_YOTI4KNiTapBGJnMrY97kJqZEMz9q1bf4bSmglC2XkJvDhHbTW/pub?gid=0&single=true&output=csv"

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


function normalizeHistoricalDraftRows(rows = [], seasonKey, adpRows = []) {
  return rows.map((row) => {
    const adpRow = findAdpRowByPlayerName(adpRows, row.player)

    return {
      seasonKey,
      seasonLabel: seasonKey,
      teamId: slugifyTeamName(canonicalTeamName(row.team)),
      teamName: canonicalTeamName(row.team),
      playerId: adpRow?.id ? String(adpRow.id) : "",
      playerName: adpRow?.name || row.player || "",
      playerPos: adpRow?.pos || adpRow?.position || "",
      pick: row.overall ?? null,
      round: row.round ?? null,
      pickInRound: row.pickInRound ?? null,
      time: row.time ?? null,
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
  findAdpRowByPlayerName(adpRows, player.name || "") ||
  null
)
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

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function headerIndex(headerMap, candidates = []) {
  for (const candidate of candidates) {
    const idx = headerMap.get(normalizeHeader(candidate))
    if (Number.isInteger(idx)) return idx
  }
  return -1
}

function splitAssetsCell(value) {
  return String(value ?? "")
    .split(/\r?\n|;|,|\u2022/)
    .map((item) => decodeMaybeBrokenText(String(item || "").trim()))
    .filter(Boolean)
}

function seasonLabelToKey(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return ""

  const direct = raw.match(/^(\d{4})-(\d{2})$/)
  if (direct) return raw

  const slash = raw.match(/^(\d{4})\/(\d{2,4})$/)
  if (slash) {
    const start = slash[1]
    const end = slash[2].slice(-2)
    return `${start}-${end}`
  }

  const year = raw.match(/^(\d{4})$/)
  if (year) {
    const endYear = Number(year[1])
    return `${endYear - 1}-${String(endYear).slice(-2)}`
  }

  return raw
}

function seasonKeyFromDate(value) {
  const text = String(value ?? "").trim()
  if (!text) return ""

  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return ""

  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const seasonStartYear = month >= 7 ? year : year - 1
  return `${seasonStartYear}-${String(seasonStartYear + 1).slice(-2)}`
}

function normalizeSheetPlayerStub(name, direction) {
  return {
    id: "",
    playerId: "",
    name: decodeMaybeBrokenText(name || ""),
    playerName: decodeMaybeBrokenText(name || ""),
    short_name: decodeMaybeBrokenText(name || ""),
    type: direction,
    pos_short_name: "",
    team_name: "",
  }
}

function normalizeHistoricalTradeRows(csvText, player) {
  if (!player) return []

  const matrix = parseCsvMatrix(csvText)
  if (!Array.isArray(matrix) || matrix.length < 2) return []

  const headerRow = matrix[0] || []
  const bodyRows = matrix.slice(1).filter((row) =>
    Array.isArray(row) && row.some((cell) => String(cell ?? "").trim())
  )

  const headerMap = new Map(
    headerRow.map((cell, index) => [normalizeHeader(cell), index])
  )

  const dateIdx = headerIndex(headerMap, [
    "date",
    "trade date",
  ])

  const teamAIdx = headerIndex(headerMap, [
    "team a",
  ])

  const teamBIdx = headerIndex(headerMap, [
    "team b",
  ])

  const sentIdx = headerIndex(headerMap, [
    "team a assets",
  ])

  const receivedIdx = headerIndex(headerMap, [
    "team b assets",
  ])

  const vetoIdx = headerIndex(headerMap, [
    "veto",
  ])

  return bodyRows.flatMap((row, index) => {
    const dateRaw = dateIdx >= 0 ? row[dateIdx] : ""
    const teamARaw = teamAIdx >= 0 ? row[teamAIdx] : ""
    const teamBRaw = teamBIdx >= 0 ? row[teamBIdx] : ""
    const sentRaw = sentIdx >= 0 ? row[sentIdx] : ""
    const receivedRaw = receivedIdx >= 0 ? row[receivedIdx] : ""
    const vetoRaw = vetoIdx >= 0 ? row[vetoIdx] : ""

    const season =
      seasonKeyFromDate(dateRaw) ||
      "2018-19"

    const teamA = canonicalTeamName(decodeMaybeBrokenText(String(teamARaw || "").trim()))
    const teamB = canonicalTeamName(decodeMaybeBrokenText(String(teamBRaw || "").trim()))

    const teamAAssets = splitAssetsCell(sentRaw)
    const teamBAssets = splitAssetsCell(receivedRaw)

    const sideATraded = teamAAssets
  .map((name) => normalizeSheetPlayerStub(name, "TRADED"))
  .filter((p) => transactionPlayerMatches(p, player))

const sideBTraded = teamBAssets
  .map((name) => normalizeSheetPlayerStub(name, "TRADED"))
  .filter((p) => transactionPlayerMatches(p, player))

const rows = []

if (sideATraded.length > 0) {
  rows.push({
    id: `sheet-${season}-${index}-a-traded`,
    season,
    date: String(dateRaw || "").trim() || "—",
    types: ["TRADE"],
    teamId: null,
    teamName: teamA || "—",
    matchedPlayers: sideATraded,
    tradeDetail: {
      teamA,
      teamB,
      teamAAssets,
      teamBAssets,
      veto: String(vetoRaw || "").trim(),
    },
  })
}

if (sideBTraded.length > 0) {
  rows.push({
    id: `sheet-${season}-${index}-b-traded`,
    season,
    date: String(dateRaw || "").trim() || "—",
    types: ["TRADE"],
    teamId: null,
    teamName: teamB || "—",
    matchedPlayers: sideBTraded,
    tradeDetail: {
      teamA,
      teamB,
      teamAAssets,
      teamBAssets,
      veto: String(vetoRaw || "").trim(),
    },
  })
}

return rows
  })
}

function TeamLinkCell({ teamId, teamName, seasonKey }) {
  if (!teamName) return <span>—</span>

  if (teamName === "Free Agent" || teamName === "Retired") {
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

function TradeDetailBlock({ detail, seasonKey }) {
  if (!detail) return null

  return (
    <div
      style={{
        marginTop: 12,
        background: "#ffffff",
        border: "1px solid #ffedd5",
        borderRadius: 14,
        padding: 14,
      }}
    >
      <div style={{ fontWeight: 800, color: "#9a3412", marginBottom: 10 }}>
        Full Trade
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>
            <TeamLinkCell teamName={detail.teamA} seasonKey={seasonKey} />
          </div>
          <div style={{ color: "#6b7280", fontSize: 14, marginBottom: 6 }}>Sent:</div>
          <div style={{ display: "grid", gap: 6 }}>
            {detail.teamAAssets?.length ? (
              detail.teamAAssets.map((asset, idx) => (
                <div key={`a-${idx}`} style={{ color: "#111827" }}>{asset}</div>
              ))
            ) : (
              <div style={{ color: "#6b7280" }}>—</div>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>
            <TeamLinkCell teamName={detail.teamB} seasonKey={seasonKey} />
          </div>
          <div style={{ color: "#6b7280", fontSize: 14, marginBottom: 6 }}>Sent:</div>
          <div style={{ display: "grid", gap: 6 }}>
            {detail.teamBAssets?.length ? (
              detail.teamBAssets.map((asset, idx) => (
                <div key={`b-${idx}`} style={{ color: "#111827" }}>{asset}</div>
              ))
            ) : (
              <div style={{ color: "#6b7280" }}>—</div>
            )}
          </div>
        </div>
      </div>

      {detail.veto ? (
        <div style={{ marginTop: 12, color: "#6b7280", fontSize: 14 }}>
          Veto: {detail.veto}
        </div>
      ) : null}
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
  const [contracts, setContracts] = useState([])

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

        const contractsPromise = fetch(CONTRACTS_CSV_URL).then(async (res) => {
          const text = await res.text()
          if (!res.ok) throw new Error(`Contracts sheet failed (${res.status}): ${text}`)
          return parseContractsCsv(text)
        })

        const currentRostersPromise = fetch(
          `/api/team-rosters?season=${encodeURIComponent(LATEST_SEASON.key)}&period=1`
        ).then(async (res) => {
          const text = await res.text()
          if (!res.ok) throw new Error(`Current season rosters failed (${res.status}): ${text}`)
          return JSON.parse(text)
        })

        const historicalTradesPromise = fetch(HISTORICAL_TRADES_SHEET_CSV_URL).then(async (res) => {
          const text = await res.text()
          if (!res.ok) throw new Error(`Historical trades sheet failed (${res.status}): ${text}`)
          return text
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
          const transactionsRes = await fetch(
            `/data/transactions-${encodeURIComponent(seasonEntry.key)}.json`
          ).catch(() => null)

          let transactionsText = ""
          if (transactionsRes) {
            transactionsText = await transactionsRes.text()
          }

          let transactionsJson = []
          if (transactionsRes?.ok && String(transactionsText || "").trim()) {
            try {
              transactionsJson = JSON.parse(transactionsText)
            } catch {
              transactionsJson = []
            }
          }

          if (!seasonEntry.leagueId) {
            return {
              seasonKey: seasonEntry.key,
              seasonLabel: seasonEntry.label,
              draftResults: { draftPicks: [] },
              teamNameMap: new Map(),
              transactionsJson,
            }
          }

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

          const draftResults = JSON.parse(draftText)
          const rosters = JSON.parse(rostersText)
          const teamNameMap = getTeamNameMapFromRosters(rosters)

          return {
            seasonKey: seasonEntry.key,
            seasonLabel: seasonEntry.label,
            draftResults,
            teamNameMap,
            transactionsJson,
          }
        })

        const [
          adpRowsRaw,
          currentRosters,
          historicalTradesCsv,
          csvGroups,
          seasonData,
          contractsRows,
        ] = await Promise.all([
          adpPromise,
          currentRostersPromise,
          historicalTradesPromise,
          Promise.all(csvPromises),
          Promise.all(seasonPromises),
          contractsPromise,
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

        const fantraxDraftRows = seasonData.flatMap((seasonBlock) =>
  normalizeDraftRows(
    seasonBlock.draftResults,
    seasonBlock.teamNameMap,
    mergedLookup,
    seasonBlock.seasonKey,
    seasonBlock.seasonLabel
  )
)

const historicalDraftRows = Object.entries(HISTORICAL_DRAFT_RESULTS).flatMap(
  ([seasonKey, rows]) => normalizeHistoricalDraftRows(rows, seasonKey, adpRows)
)

const draftRows = [...fantraxDraftRows, ...historicalDraftRows]

        const resolvedPlayer = findPlayerBySlug(
          playerSlug,
          adpRows,
          flatCsvRows,
          draftRows
        )

        if (!resolvedPlayer) {
          throw new Error("Player not found.")
        }

        const fantraxCareer = seasonData.flatMap((seasonBlock) =>
          normalizeTransactionRows(
            seasonBlock.transactionsJson,
            resolvedPlayer,
            seasonBlock.seasonKey
          )
        )

        const historicalTradeCareer = normalizeHistoricalTradeRows(
          historicalTradesCsv,
          resolvedPlayer
        )

        const normalizedCareer = sortTransactionsDesc([
          ...fantraxCareer,
          ...historicalTradeCareer,
        ])

        if (!cancelled) {
          setCurrentAdpRows(adpRows)
          setHistoricalCsvRows(flatCsvRows)
          setAllDraftRows(draftRows)
          setCurrentSeasonRosters(currentRosters)
          setCareerRows(normalizedCareer)
          setContracts(contractsRows)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setCurrentAdpRows([])
          setHistoricalCsvRows([])
          setAllDraftRows([])
          setCurrentSeasonRosters(null)
          setCareerRows([])
          setContracts([])
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

  const playerContract = useMemo(() => {
    if (!player) return null

    const directTarget = normalizeContractPlayerName(player.name)

    const flippedName = player.name?.includes(",")
      ? player.name
          .split(",")
          .map((x) => x.trim())
          .reverse()
          .join(" ")
      : ""

    const flippedTarget = normalizeContractPlayerName(flippedName)

    return (
      contracts.find((row) => {
        const rowName = normalizeContractPlayerName(row.player)
        return rowName === directTarget || rowName === flippedTarget
      }) || null
    )
  }, [contracts, player])

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
          <StatCard label="Contract Expiry" value={playerContract?.expiryYear ?? "—"} />
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

{tx.tradeDetail ? (
  <TradeDetailBlock detail={tx.tradeDetail} seasonKey={tx.season} />
) : null}
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