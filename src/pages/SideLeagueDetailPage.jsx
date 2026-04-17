import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { getSideleagueByKey } from "../config/sideleagues"
import {
  decodeMaybeBrokenText,
  extractTeamsFromLeagueInfo,
  getRosterForTeam,
  enrichRosterItems,
  buildPlayerLookupFromAdp,
  cleanFantraxPlayerId,
} from "../utils/fantrax"
import { canonicalTeamName, slugifyTeamName } from "../utils/history"

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function formatValue(value) {
  if (value == null || value === "") return "—"
  return String(value)
}

function TeamNameLink({ teamName }) {
  const clean = canonicalTeamName(teamName)
  if (!clean) return <span>—</span>

  return (
    <Link
      to={`/teams/${slugifyTeamName(clean)}`}
      style={{ color: "#111827", fontWeight: 700, textDecoration: "none" }}
    >
      {clean}
    </Link>
  )
}

function SideleagueTeamLink({ teamName }) {
  const clean = String(teamName || "").trim()
  if (!clean) return <span>—</span>

  return (
    <Link
      to={`/sideleagues/teams/${encodeURIComponent(clean)}`}
      style={{ color: "#111827", fontWeight: 800, textDecoration: "none" }}
    >
      {clean}
    </Link>
  )
}

function getTeamByConfiguredName(teams = [], targetName = "") {
  const target = normalizeName(targetName)
  return (
    teams.find((team) => normalizeName(team?.name) === target) ||
    teams.find((team) => normalizeName(team?.shortName) === target) ||
    null
  )
}

function formatPlayerIdsName(name) {
  const clean = String(name || "").trim()
  if (!clean.includes(",")) return clean
  const [last, first] = clean.split(",").map((x) => x.trim())
  return [first, last].filter(Boolean).join(" ")
}

function normalizePlayerIdsPayload(payload) {
  if (!payload || typeof payload !== "object") return []

  return Object.values(payload)
    .filter((item) => item && typeof item === "object")
    .filter((item) => String(item.position || "").trim().toUpperCase() !== "TM")
    .map((item) => ({
      id: cleanFantraxPlayerId(item.fantraxId || item.id || ""),
      name: formatPlayerIdsName(item.name || ""),
      pos: String(item.position || item.pos || "").trim(),
      team: String(item.team || "").trim(),
      adp: null,
      raw: item,
    }))
    .filter((item) => item.id && item.name)
}

function parseCsvGrid(text = "") {
  const rows = []
  let row = []
  let cell = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === "," && !inQuotes) {
      row.push(cell)
      cell = ""
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else {
      cell += ch
    }
  }

  row.push(cell)
  rows.push(row)
  return rows
}

function normalizeSheetText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseSheetNumber(value) {
  const text = String(value ?? "").trim().replace(",", ".")
  const num = Number(text)
  return Number.isFinite(num) ? num : null
}

function isDraftRoundLabel(text) {
  const value = normalizeSheetText(text)
  return /^\d+ος γύρος$/i.test(value)
}

function parseDraftEntryCell(text, currentRound = null, teamNames = []) {
  const value = normalizeSheetText(text)
  if (!value) return null
  if (isDraftRoundLabel(value)) return null
  if (/^Ομάδα\s+Παίκτης$/i.test(value)) return null

  const overallMatch = value.match(/^(\d+)\s+(.+)$/)
  if (!overallMatch) return null

  const overall = Number(overallMatch[1])
  const rest = normalizeSheetText(overallMatch[2])

  if (!Number.isFinite(overall) || !rest) return null

  const matchedTeam =
    [...teamNames]
      .sort((a, b) => b.length - a.length)
      .find((team) => rest === team || rest.startsWith(`${team} `)) || null

  if (!matchedTeam) return null

  const playerAndClub = normalizeSheetText(rest.slice(matchedTeam.length))
  const playerClubMatch = playerAndClub.match(/^(.*?)\s*\(([^)]+)\)$/)

  if (!playerClubMatch) return null

  const player = normalizeSheetText(playerClubMatch[1])
  const club = normalizeSheetText(playerClubMatch[2])

  if (!player || !club) return null

  return {
    round: currentRound,
    overall,
    team: matchedTeam,
    player,
    club,
  }
}

function formatDraftRoundLabel(round) {
  return String(round || "").replace(/\s*ος\s+γύρος/i, "").trim()
}

function parseEuroleagueDraftCsv(text = "") {
  const grid = parseCsvGrid(text)

  const euroleagueTeams = [
    "Bridgeburners",
    "Samarina Dudenbros",
    "Colonos Gypsies",
    "Ancrum heirs",
    "LarryOBrienPhoenix",
    "Xanthi Ducks",
    "Γιουγκοσφάχτηκα",
    "Green Guns",
    "Fourogatoi",
    "PRISONball",
  ]

  let currentRound = null
  const picks = []

  for (const row of grid) {
    const cells = row.map((cell) => normalizeSheetText(cell)).filter(Boolean)
    if (!cells.length) continue

    const joined = cells.join(" ")

    if (isDraftRoundLabel(joined)) {
      currentRound = joined
      continue
    }

    if (/^Ομάδα\s+Παίκτης$/i.test(joined)) continue

    // Case 1: row split into columns: overall | team | player(club)
    const firstNum = Number(cells[0])
    if (Number.isFinite(firstNum) && cells.length >= 3) {
      const overall = firstNum
      const team = cells[1]
      const playerClub = cells.slice(2).join(" ")
      const teamMatched = euroleagueTeams.find(
        (name) => normalizeSheetText(name) === normalizeSheetText(team)
      )

      const m = playerClub.match(/^(.*?)\s*\(([^)]+)\)$/)
      if (teamMatched && m) {
        picks.push({
          round: currentRound,
          overall,
          team: teamMatched,
          player: normalizeSheetText(m[1]),
          club: normalizeSheetText(m[2]),
        })
        continue
      }
    }

    // Case 2: whole pick stored in one cell
    const singleCellMatch = joined.match(/^(\d+)\s+(.+)$/)
    if (singleCellMatch) {
      const overall = Number(singleCellMatch[1])
      const rest = normalizeSheetText(singleCellMatch[2])

      const matchedTeam =
        [...euroleagueTeams]
          .sort((a, b) => b.length - a.length)
          .find((team) => rest === team || rest.startsWith(`${team} `)) || null

      if (matchedTeam) {
        const playerAndClub = normalizeSheetText(rest.slice(matchedTeam.length))
        const m = playerAndClub.match(/^(.*?)\s*\(([^)]+)\)$/)

        if (m) {
          picks.push({
            round: currentRound,
            overall,
            team: matchedTeam,
            player: normalizeSheetText(m[1]),
            club: normalizeSheetText(m[2]),
          })
        }
      }
    }
  }

  return picks.sort((a, b) => {
    const roundA = Number(String(a.round || "").match(/\d+/)?.[0] || 999)
    const roundB = Number(String(b.round || "").match(/\d+/)?.[0] || 999)
    if (roundA !== roundB) return roundA - roundB
    return a.overall - b.overall
  })
}



function isRoundLabel(text) {
  const upper = normalizeSheetText(text).toUpperCase()
  return (
    upper.startsWith("PLAY-IN") ||
    upper.startsWith("PLAYOFF") ||
    upper.startsWith("SEMIFINAL") ||
    upper === "FINAL" ||
    upper.startsWith("FINAL ")
  )
}

function MatchupScores({ matchup }) {
  const games = Array.isArray(matchup?.games) ? matchup.games : []

  if (!games.length) {
    return (
      <>
        <div>
          <strong>{matchup.team1}</strong>
          {matchup.seed1 ? ` (${matchup.seed1})` : ""}
          {" · "}
          {matchup.scores1.join(" / ")}
        </div>

        <div>
          <strong>{matchup.team2}</strong>
          {matchup.seed2 ? ` (${matchup.seed2})` : ""}
          {" · "}
          {matchup.scores2.join(" / ")}
        </div>
      </>
    )
  }

  return (
    <>
      <div>
        <strong>{matchup.team1}</strong>
        {matchup.seed1 ? ` (${matchup.seed1})` : ""}
        {" · "}
        {games.map((game, idx) => (
          <span
            key={`t1-${idx}`}
            style={{
              color: game.winner === "team1" ? "#166534" : "#111827",
              fontWeight: game.winner === "team1" ? 900 : 500,
            }}
          >
            {idx > 0 ? " / " : ""}
            {game.team1}
          </span>
        ))}
      </div>

      <div>
        <strong>{matchup.team2}</strong>
        {matchup.seed2 ? ` (${matchup.seed2})` : ""}
        {" · "}
        {games.map((game, idx) => (
          <span
            key={`t2-${idx}`}
            style={{
              color: game.winner === "team2" ? "#166534" : "#111827",
              fontWeight: game.winner === "team2" ? 900 : 500,
            }}
          >
            {idx > 0 ? " / " : ""}
            {game.team2}
          </span>
        ))}
      </div>
    </>
  )
}

function EuroleagueMatchupCard({ matchup }) {
  return (
    <div
      style={{
        background: "#fff7ed",
        border: "1px solid #fed7aa",
        borderRadius: 20,
        padding: 18,
      }}
    >
      <div style={{ color: "#f97316", fontWeight: 800, marginBottom: 10 }}>
        {matchup.round}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <MatchupScores matchup={matchup} />

        <div style={{ color: "#6b7280", fontWeight: 700 }}>
          Series: {matchup.wins1}-{matchup.wins2}
          {matchup.winner ? ` · Winner: ${matchup.winner}` : ""}
        </div>
      </div>
    </div>
  )
}

function getPhaseFromHeader(text) {
  const upper = normalizeSheetText(text).toUpperCase()
  if (upper.startsWith("PLAY-IN(")) return "Play-In"
  if (upper.startsWith("PLAYOFFS(")) return "Playoffs"
  if (upper.startsWith("FINAL FOUR(")) return "Final Four"
  return ""
}


function extractSeed(text) {
  const match = String(text ?? "").match(/\((\d+)(?:ος|η|oς|th)?\)/i)
  return match ? Number(match[1]) : null
}

function cleanTeamName(text) {
  return normalizeSheetText(
    String(text ?? "").replace(/\(\d+(?:ος|η|oς|th)?\)/gi, "")
  )
}

function isLikelyTeamCell(text) {
  const value = normalizeSheetText(text)
  if (!value) return false
  if (isRoundLabel(value)) return false
  if (/PLAY-IN|PLAYOFF|SEMIFINAL|FINAL/i.test(value)) return false
  return /\(\d+(?:ος|η|oς|th)?\)/i.test(value) || /[A-Za-zΑ-Ωα-ω]/.test(value)
}

function getRowScores(grid, rowIndex, startCol) {
  const row = grid[rowIndex] || []
  const scores = []

  for (let c = startCol + 1; c < row.length; c += 1) {
    const raw = normalizeSheetText(row[c])
    if (!raw) continue

    const num = parseSheetNumber(raw)
    if (Number.isFinite(num)) {
      scores.push(num)
    }
  }

  return scores
}

function isPhaseHeader(text) {
  const upper = normalizeSheetText(text).toUpperCase()
  return (
    upper.startsWith("PLAY-IN(") ||
    upper.startsWith("PLAYOFFS(") ||
    upper.startsWith("FINAL FOUR(")
  )
}

function isMatchupLabel(text) {
  const upper = normalizeSheetText(text).toUpperCase()
  return (
    /^PLAY-IN\s+[A-ZΑ-Ω]$/.test(upper) ||
    /^PLAYOFF\s+[A-ZΑ-Ω]$/.test(upper) ||
    /^SEMIFINAL\s+[A-ZΑ-Ω]$/.test(upper) ||
    upper === "FINAL"
  )
}


function tallySeries(scoresA = [], scoresB = []) {
  const length = Math.min(scoresA.length, scoresB.length)
  let winsA = 0
  let winsB = 0
  const games = []

  for (let i = 0; i < length; i += 1) {
    const a = Number(scoresA[i])
    const b = Number(scoresB[i])
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue

    let winner = "tie"
    if (a > b) {
      winner = "team1"
      winsA += 1
    } else if (b > a) {
      winner = "team2"
      winsB += 1
    }

    games.push({
      game: i + 1,
      team1: a,
      team2: b,
      winner,
    })
  }

  let seriesWinner = null
  if (winsA > winsB) seriesWinner = "team1"
  else if (winsB > winsA) seriesWinner = "team2"

  return { winsA, winsB, games, seriesWinner }
}

function groupEuroleagueMatchups(matchups = []) {
  const phaseOrder = {
    "FINAL FOUR": 1,
    PLAYOFFS: 2,
    "PLAY-IN": 3,
  }

  const roundWeight = (round = "") => {
    const upper = normalizeSheetText(round).toUpperCase()

    if (upper === "FINAL") return 1
    if (upper.startsWith("SEMIFINAL")) return 2
    if (upper.startsWith("PLAYOFF")) return 3
    if (upper.startsWith("PLAY-IN")) return 4
    return 99
  }

  const sorted = [...matchups].sort((a, b) => {
    const phaseDiff = (phaseOrder[a.phaseKey] || 99) - (phaseOrder[b.phaseKey] || 99)
    if (phaseDiff !== 0) return phaseDiff

    const roundDiff = roundWeight(a.round) - roundWeight(b.round)
    if (roundDiff !== 0) return roundDiff

    return String(a.round || "").localeCompare(String(b.round || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  })

  const groups = []
  for (const matchup of sorted) {
    const phaseKey = matchup.phaseKey || "OTHER"
    let group = groups.find((item) => item.phaseKey === phaseKey)

    if (!group) {
      group = {
        phaseKey,
        phase:
          phaseKey === "PLAY-IN"
            ? "PLAY-IN"
            : phaseKey === "PLAYOFFS"
              ? "PLAYOFFS"
              : phaseKey === "FINAL FOUR"
                ? "FINAL FOUR"
                : "OTHER",
        items: [],
      }
      groups.push(group)
    }

    group.items.push(matchup)
  }

  return groups
}

function parseEuroleagueResultsCsv(text = "") {
  const grid = parseCsvGrid(text)

  function getZone(col) {
    if (col >= 0 && col <= 5) return "PLAY-IN"
    if (col >= 7 && col <= 13) return "PLAYOFFS"
    if (col >= 15) return "FINAL FOUR"
    return ""
  }

  function getPhaseLabel(zone) {
    if (zone === "PLAY-IN") return "Play-In"
    if (zone === "PLAYOFFS") return "Playoffs"
    if (zone === "FINAL FOUR") return "Final Four"
    return ""
  }

  const cells = []
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      const value = normalizeSheetText(grid[r][c])
      if (value) {
        cells.push({
          row: r,
          col: c,
          value,
          zone: getZone(c),
        })
      }
    }
  }

  const matchupLabels = cells
    .filter((cell) => isMatchupLabel(cell.value))
    .sort((a, b) => {
      const zoneOrder = { "FINAL FOUR": 1, PLAYOFFS: 2, "PLAY-IN": 3 }
      const zd = (zoneOrder[a.zone] || 99) - (zoneOrder[b.zone] || 99)
      if (zd !== 0) return zd
      return (a.row - b.row) || (a.col - b.col)
    })

  function getRowScores(gridRows, rowIndex, startCol, zone) {
    const row = gridRows[rowIndex] || []
    const scores = []

    for (let c = startCol + 1; c < row.length; c += 1) {
      if (getZone(c) !== zone) break

      const raw = normalizeSheetText(row[c])
      if (!raw) continue

      const num = parseSheetNumber(raw)
      if (Number.isFinite(num)) {
        scores.push(num)
      }
    }

    if (zone === "PLAY-IN" || zone === "FINAL FOUR") {
      return scores.length ? [scores[0]] : []
    }

    return scores.slice(0, 5)
  }

  const matchups = matchupLabels
    .map((label, idx) => {
      const sameZoneLabels = matchupLabels.filter((x) => x.zone === label.zone)
      const currentIndex = sameZoneLabels.findIndex(
        (x) => x.row === label.row && x.col === label.col && x.value === label.value
      )
      const nextLabel = sameZoneLabels[currentIndex + 1] || null

      const candidateTeamCells = cells
        .filter((cell) => {
          if (cell.zone !== label.zone) return false
          if (cell.row <= label.row) return false
          if (nextLabel && cell.row >= nextLabel.row) return false
          if (Math.abs(cell.col - label.col) > 4) return false
          return isLikelyTeamCell(cell.value)
        })
        .sort((a, b) => (a.row - b.row) || (a.col - b.col))

      const teams = []
      const seenRows = new Set()

      for (const cell of candidateTeamCells) {
        if (seenRows.has(cell.row)) continue

        const name = cleanTeamName(cell.value)
        if (!name) continue

        const scores = getRowScores(grid, cell.row, cell.col, label.zone)
        const seed = extractSeed(cell.value)

        teams.push({
          name,
          seed,
          scores,
          row: cell.row,
          col: cell.col,
        })

        seenRows.add(cell.row)
        if (teams.length === 2) break
      }

      if (teams.length < 2) return null

      const series = tallySeries(teams[0].scores, teams[1].scores)

      return {
        phase: getPhaseLabel(label.zone),
        phaseKey: label.zone,
        round: normalizeSheetText(label.value),
        team1: teams[0].name,
        seed1: teams[0].seed,
        scores1: teams[0].scores,
        team2: teams[1].name,
        seed2: teams[1].seed,
        scores2: teams[1].scores,
        wins1: series.winsA,
        wins2: series.winsB,
        games: series.games,
        winner:
          series.seriesWinner === "team1"
            ? teams[0].name
            : series.seriesWinner === "team2"
              ? teams[1].name
              : null,
      }
    })
    .filter(Boolean)

  const finalMatchup =
    matchups.find((m) => normalizeSheetText(m.round).toUpperCase() === "FINAL") || null

  return {
    matchups,
    champion: finalMatchup?.winner || null,
    runnerUp:
      finalMatchup?.winner === finalMatchup?.team1
        ? finalMatchup?.team2
        : finalMatchup?.winner === finalMatchup?.team2
          ? finalMatchup?.team1
          : null,
  }
}


function getComparableCategoryEntries(teamStats = {}, scoringCategories = []) {
  const statAliasMap = {
    PTS: ["points"],
    REB: ["reb", "rebounds"],
    AST: ["ast", "assists"],
    ST: ["st", "steals"],
    STL: ["st", "steals"],
    BLK: ["blk", "blocks"],
    FGM: ["fgm"],
    "FG%": ["fgPct"],
    FG: ["fgPct"],
    "3PM": ["tpm"],
    TPM: ["tpm"],
    "3PT%": ["tpPct"],
    "3P%": ["tpPct"],
    "FT%": ["ftPct"],
    OREB: ["oreb"],
    DREB: ["dreb"],
    TO: ["to"],
    "A/T": ["aTo"],
    "AST/TO": ["aTo"],
    "3PTM": ["tpm"],
    "A/TO": ["aTo"],
  }

  return scoringCategories
    .map((cat) => {
      const shortName = String(cat?.shortName || "").trim()
      if (!shortName) return null

      const aliases = statAliasMap[shortName] || []
      for (const key of aliases) {
        const value = teamStats?.[key]
        if (value != null && value !== "") {
          return {
            shortName,
            statKey: key,
            value: Number(value),
          }
        }
      }

      return null
    })
    .filter(Boolean)
}

function compareCategoryWins(teamAStats = {}, teamBStats = {}, scoringCategories = []) {
  const aEntries = getComparableCategoryEntries(teamAStats, scoringCategories)
  const result = []

  for (const entry of aEntries) {
    const aVal = Number(entry.value)
    const bRaw = teamBStats?.[entry.statKey]
    const bVal = bRaw == null || bRaw === "" ? null : Number(bRaw)

    if (!Number.isFinite(aVal) || !Number.isFinite(bVal)) continue

    let winner = "tie"

    // lower is better only for TO
    if (entry.statKey === "to") {
      if (aVal < bVal) winner = "a"
      else if (bVal < aVal) winner = "b"
    } else {
      if (aVal > bVal) winner = "a"
      else if (bVal > aVal) winner = "b"
    }

    result.push({
      shortName: entry.shortName,
      statKey: entry.statKey,
      aVal,
      bVal,
      winner,
    })
  }

  return result
}

function buildPlayerLookupFromPlayerIds(playerIdsRows = []) {
  const map = new Map()

  for (const row of playerIdsRows) {
    const id = cleanFantraxPlayerId(row?.id || row?.fantraxId || "")
    if (!id) continue

    map.set(id, {
      id,
      name: decodeMaybeBrokenText(row?.name || id),
      pos: row?.pos || row?.position || "",
      team: row?.team || "",
      adp: null,
      raw: row,
    })
  }

  return map
}

function getStandingRows(payload) {
  const candidates = [
    payload?.records,
    payload?.standings,
    payload?.overall,
    payload?.table,
    payload?.results,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate
  }

  if (Array.isArray(payload)) return payload
  return []
}

function getStandingRank(row, index) {
  const candidates = [row?.rank, row?.place, row?.standing, row?.seed, row?.position]

  for (const value of candidates) {
    const num = Number(value)
    if (Number.isFinite(num)) return num
  }

  return index + 1
}

function getStandingTeam(row) {
  return decodeMaybeBrokenText(
    row?.teamName ||
      row?.name ||
      row?.team ||
      row?.franchiseName ||
      row?.team?.name ||
      row?.teamNameShort ||
      ""
  )
}

function getStandingPoints(row) {
  const candidates = [row?.points, row?.pts, row?.rotisseriePoints, row?.score, row?.totalPoints]

  for (const value of candidates) {
    const num = Number(value)
    if (Number.isFinite(num)) return num
  }

  return null
}

function formatStatNumber(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return "—"
  return Number.isInteger(num) ? String(num) : String(num)
}

function getCategoryStatEntries(teamStats = {}, scoringCategories = []) {
  const statAliasMap = {
    PTS: ["points"],
    REB: ["reb", "rebounds"],
    AST: ["ast", "assists"],
    ST: ["st", "steals"],
    STL: ["st", "steals"],
    BLK: ["blk", "blocks"],
    FGM: ["fgm"],
    "FG%": ["fgPct"],
    FG: ["fgPct"],
    "3PM": ["tpm"],
    TPM: ["tpm"],
    "3PT%": ["tpPct"],
    "3P%": ["tpPct"],
    "FT%": ["ftPct"],
    OREB: ["oreb"],
    DREB: ["dreb"],
    TO: ["to"],
    "A/T": ["aTo"],
    "AST/TO": ["aTo"],
    "3PTM": ["tpm"],
    "A/TO": ["aTo"],
  }

  const entries = []

  for (const cat of scoringCategories) {
    const shortName = String(cat?.shortName || "").trim()
    if (!shortName) continue

    const candidateKeys = statAliasMap[shortName] || []
    let foundValue = null
    let statKey = null

    for (const key of candidateKeys) {
      if (teamStats?.[key] != null && teamStats?.[key] !== "") {
        foundValue = teamStats[key]
        statKey = key
        break
      }
    }

    if (foundValue == null || !statKey) continue

    entries.push({
      shortName,
      statKey,
      value: Number(foundValue),
    })
  }

  return entries
}

function TeamStatsStrip({ teamStats = {}, opponentStats = {}, scoringCategories = [] }) {
  const entries = useMemo(
    () => getCategoryStatEntries(teamStats, scoringCategories),
    [teamStats, scoringCategories]
  )

  if (!entries.length) return null

  return (
    <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
      {entries.map((item) => {
        const ownValue = Number(item.value)
        const oppValueRaw = opponentStats?.[item.statKey]
        const oppValue =
          oppValueRaw == null || oppValueRaw === "" ? null : Number(oppValueRaw)

        const winsCategory =
          Number.isFinite(ownValue) &&
          Number.isFinite(oppValue) &&
          ownValue > oppValue

        return (
          <div
            key={item.shortName}
            style={{
              ...statChip,
              background: winsCategory ? "#dcfce7" : "#fff7ed",
              border: winsCategory ? "1px solid #86efac" : "1px solid #fed7aa",
            }}
          >
            <span
              style={{
                ...statChipKey,
                color: winsCategory ? "#166534" : "#6b7280",
              }}
            >
              {item.shortName}
            </span>
            <span
              style={{
                ...statChipVal,
                color: winsCategory ? "#166534" : "#111827",
              }}
            >
              {formatStatNumber(item.value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function TeamRosterCard({ title, rows = [] }) {
  return (
    <section style={sectionCard}>
      <h2 style={{ margin: "0 0 14px", fontSize: 24 }}>{title}</h2>

      {!rows.length ? (
        <div style={{ color: "#6b7280" }}>No roster found.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Player</th>
                <th style={th}>Pos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((player, idx) => (
                <tr key={`${player.id || player.playerName || "player"}-${idx}`}>
                  <td style={td}>{player.playerName || "—"}</td>
                  <td style={td}>{player.playerPos || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ChampionCard({ champion, seasonLabel }) {
  if (!champion) return null

  return (
    <section style={sectionCard}>
      <div style={eyebrow}>Champion</div>

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ fontSize: 40, lineHeight: 1 }}>🏆</div>
        <div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#111827" }}>
            <TeamNameLink teamName={champion.team} />
          </div>
          <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 600 }}>
            {seasonLabel || "—"} · Rank {champion.rank} · Pts {champion.points ?? "—"}
          </div>
        </div>
      </div>
    </section>
  )
}

function FinalStandingsCard({ rows = [] }) {
  return (
    <section style={sectionCard}>
      <h2 style={{ margin: "0 0 14px", fontSize: 24 }}>Final Standings</h2>

      {!rows.length ? (
        <div style={{ color: "#6b7280" }}>No standings found.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Rank</th>
                <th style={th}>Team</th>
                <th style={th}>Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.rank}-${row.team}`}>
                  <td style={td}>{row.rank}</td>
                  <td style={td}>
                    <TeamNameLink teamName={row.team} />
                  </td>
                  <td style={td}>{row.points ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function RulesStrip({ categories = [] }) {
  if (!categories.length) return null

  return (
    <section style={{ marginTop: 18 }}>
      <div style={miniTitle}>Scoring Categories</div>
      <div style={chipWrap}>
        {categories.map((cat, idx) => (
          <div key={`${cat.shortName}-${idx}`} style={chip}>
            <span style={chipKey}>{cat.shortName}</span>
            <span style={chipVal}>x{formatValue(cat.weight)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

const th = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #fed7aa",
  color: "#6b7280",
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
}

const td = {
  padding: "12px",
  borderBottom: "1px solid #ffedd5",
  color: "#111827",
}

const sectionCard = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 24,
  padding: 20,
}

const eyebrow = {
  display: "inline-flex",
  padding: "8px 12px",
  borderRadius: 999,
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  color: "#ea580c",
  fontWeight: 800,
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
}

const miniTitle = {
  color: "#6b7280",
  fontWeight: 700,
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 8,
}

const chipWrap = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
}

const chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderRadius: 999,
  background: "#fff7ed",
  border: "1px solid #fed7aa",
}

const chipKey = {
  color: "#111827",
  fontWeight: 800,
  fontSize: 13,
}

const chipVal = {
  color: "#ea580c",
  fontWeight: 800,
  fontSize: 13,
}

const statChip = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 11px",
  borderRadius: 999,
  background: "#fff7ed",
  border: "1px solid #fed7aa",
}

const statChipKey = {
  color: "#6b7280",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
}

const statChipVal = {
  color: "#111827",
  fontWeight: 900,
  fontSize: 13,
}

export default function SideLeagueDetailPage() {
  const { sideleagueKey } = useParams()
  const sideleague = getSideleagueByKey(sideleagueKey)

  const [resultsPayload, setResultsPayload] = useState(null)
  const [leagueInfo, setLeagueInfo] = useState(null)
  const [rostersPayload, setRostersPayload] = useState(null)
  const [standingsPayload, setStandingsPayload] = useState(null)
  const [playerLookup, setPlayerLookup] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [sheetResults, setSheetResults] = useState(null)
  const [sheetDraftPicks, setSheetDraftPicks] = useState([])
  const [sheetTab, setSheetTab] = useState("matchups")
const [draftView, setDraftView] = useState("byPick")

  

  useEffect(() => {
  let cancelled = false

  async function load() {
    if (!sideleague) {
      setError("Sideleague not found.")
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError("")

      let resultsJson = null
      let liveLeagueInfo = null
      let liveRosters = null
      let liveStandings = null
      let lookup = new Map()

      if (sideleague.view === "sheet_league") {
  const resultsRes = await fetch(sideleague.resultsCsvUrl)
  const resultsText = await resultsRes.text()

  if (!resultsRes.ok) {
    throw new Error(`Results sheet failed (${resultsRes.status}): ${resultsText}`)
  }

  const draftRes = await fetch(sideleague.draftCsvUrl)
  const draftText = await draftRes.text()

  if (!draftRes.ok) {
    throw new Error(`Draft sheet failed (${draftRes.status}): ${draftText}`)
  }

  const parsedSheetResults = parseEuroleagueResultsCsv(resultsText)
  const parsedDraftPicks = parseEuroleagueDraftCsv(draftText)

  if (!cancelled) {
    setResultsPayload(null)
    setLeagueInfo(null)
    setRostersPayload(null)
    setStandingsPayload(null)
    setPlayerLookup(new Map())
    setSheetResults(parsedSheetResults)
    setSheetDraftPicks(parsedDraftPicks)
  }

  return
}

      const resultsRes = await fetch(`/data/sideleagues/${sideleague.key}.json`)
      const resultsText = await resultsRes.text()

      if (!resultsRes.ok) {
        throw new Error(`Sideleague results json failed (${resultsRes.status}): ${resultsText}`)
      }

      resultsJson = JSON.parse(resultsText)

      const sideleagueRes = await fetch(
        `/api/sideleague?leagueId=${encodeURIComponent(sideleague.leagueId)}&period=${encodeURIComponent(
          sideleague.period || 1
        )}`
      )
      const sideleagueText = await sideleagueRes.text()

      if (!sideleagueRes.ok) {
        throw new Error(`Sideleague API failed (${sideleagueRes.status}): ${sideleagueText}`)
      }

      const sideleagueJson = JSON.parse(sideleagueText)

      liveLeagueInfo = sideleagueJson?.leagueInfo || null
      liveRosters = sideleagueJson?.rosters || null
      liveStandings = sideleagueJson?.standings || null

      if (sideleague.view === "matchup_rosters") {
        const adpRes = await fetch(`/api/adp`)
        const adpText = await adpRes.text()

        if (!adpRes.ok) {
          throw new Error(`ADP failed (${adpRes.status}): ${adpText}`)
        }

        let adpJson = []
        try {
          adpJson = JSON.parse(adpText)
        } catch {
          adpJson = []
        }

        const safeAdpRows = Array.isArray(adpJson) ? adpJson : []

        if (safeAdpRows.length > 0) {
          lookup = buildPlayerLookupFromAdp(safeAdpRows)
        } else {
          const playerIdsRes = await fetch(`/api/player-ids`)
          const playerIdsText = await playerIdsRes.text()

          if (!playerIdsRes.ok) {
            throw new Error(`Player IDs failed (${playerIdsRes.status}): ${playerIdsText}`)
          }

          let playerIdsJson = {}
          try {
            playerIdsJson = JSON.parse(playerIdsText)
          } catch {
            playerIdsJson = {}
          }

          lookup = buildPlayerLookupFromPlayerIds(
            normalizePlayerIdsPayload(playerIdsJson)
          )
        }
      }

      if (!cancelled) {
        setResultsPayload(resultsJson)
        setLeagueInfo(liveLeagueInfo)
        setRostersPayload(liveRosters)
        setStandingsPayload(liveStandings)
        setPlayerLookup(lookup)
        setSheetResults(null)
        setSheetDraftPicks([])

        }
    } catch (err) {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Unknown error")
        setResultsPayload(null)
        setLeagueInfo(null)
        setRostersPayload(null)
        setStandingsPayload(null)
        setPlayerLookup(new Map())
        setSheetResults(null)
        setSheetDraftPicks([])

      }
    } finally {
      if (!cancelled) setLoading(false)
    }
  }

  load()
  return () => {
    cancelled = true
  }
}, [sideleague])

  const matchups = useMemo(() => {
  return Array.isArray(resultsPayload?.matchups) ? resultsPayload.matchups : []
}, [resultsPayload])

const groupedSheetMatchups = useMemo(() => {
  return groupEuroleagueMatchups(sheetResults?.matchups || [])
}, [sheetResults])

const southSourceTeam = useMemo(() => {
  const target = normalizeName(sideleague?.teams?.[0] || "South")

  for (const matchup of matchups) {
    const teams = Array.isArray(matchup?.teams) ? matchup.teams : []
    const found = teams.find((team) => normalizeName(team?.name || "") === target)
    if (found) return found
  }

  return null
}, [matchups, sideleague])

const northSourceTeam = useMemo(() => {
  const target = normalizeName(sideleague?.teams?.[1] || "North")

  for (const matchup of matchups) {
    const teams = Array.isArray(matchup?.teams) ? matchup.teams : []
    const found = teams.find((team) => normalizeName(team?.name || "") === target)
    if (found) return found
  }

  return null
}, [matchups, sideleague])

const rulesData = useMemo(() => {
  const scoringSystem = leagueInfo?.scoringSystem || {}

  const categories =
    scoringSystem?.scoringCategorySettings?.[0]?.configs?.map((cfg) => ({
      shortName: cfg?.scoringCategory?.shortName || "—",
      name: cfg?.scoringCategory?.name || "—",
      weight: cfg?.weight ?? "—",
    })) || []

  return { categories }
}, [leagueInfo])

const categoryComparison = useMemo(() => {
  return compareCategoryWins(
    southSourceTeam?.stats || {},
    northSourceTeam?.stats || {},
    rulesData.categories
  )
}, [southSourceTeam, northSourceTeam, rulesData.categories])

const southCategoryWins = useMemo(() => {
  return categoryComparison.filter((item) => item.winner === "a").length
}, [categoryComparison])

const northCategoryWins = useMemo(() => {
  return categoryComparison.filter((item) => item.winner === "b").length
}, [categoryComparison])

const computedWinnerTeam = useMemo(() => {
  if (!southSourceTeam && !northSourceTeam) return null
  if (!southSourceTeam) return northSourceTeam
  if (!northSourceTeam) return southSourceTeam

  if (southCategoryWins > northCategoryWins) return southSourceTeam
  if (northCategoryWins > southCategoryWins) return northSourceTeam

  return southSourceTeam
}, [southSourceTeam, northSourceTeam, southCategoryWins, northCategoryWins])

const computedLoserTeam = useMemo(() => {
  if (!southSourceTeam || !northSourceTeam) return null
  return computedWinnerTeam?.name === southSourceTeam?.name ? northSourceTeam : southSourceTeam
}, [southSourceTeam, northSourceTeam, computedWinnerTeam])

const winnerScore = useMemo(() => {
  if (!computedWinnerTeam) return null
  return computedWinnerTeam?.name === southSourceTeam?.name
    ? southCategoryWins
    : northCategoryWins
}, [computedWinnerTeam, southSourceTeam, southCategoryWins, northCategoryWins])

const loserScore = useMemo(() => {
  if (!computedLoserTeam) return null
  return computedLoserTeam?.name === southSourceTeam?.name
    ? southCategoryWins
    : northCategoryWins
}, [computedLoserTeam, southSourceTeam, southCategoryWins, northCategoryWins])

  const liveTeams = useMemo(() => extractTeamsFromLeagueInfo(leagueInfo || {}), [leagueInfo])

  const southLiveTeam = useMemo(
    () => getTeamByConfiguredName(liveTeams, sideleague?.teams?.[0] || "South"),
    [liveTeams, sideleague]
  )

  const northLiveTeam = useMemo(
    () => getTeamByConfiguredName(liveTeams, sideleague?.teams?.[1] || "North"),
    [liveTeams, sideleague]
  )

  const southRoster = useMemo(() => {
    if (!rostersPayload || !southLiveTeam?.id) return []
    return enrichRosterItems(getRosterForTeam(rostersPayload, southLiveTeam.id), playerLookup)
  }, [rostersPayload, southLiveTeam, playerLookup])

  const northRoster = useMemo(() => {
    if (!rostersPayload || !northLiveTeam?.id) return []
    return enrichRosterItems(getRosterForTeam(rostersPayload, northLiveTeam.id), playerLookup)
  }, [rostersPayload, northLiveTeam, playerLookup])

  const finalStandings = useMemo(() => {
    const rows = getStandingRows(standingsPayload)

    return rows
      .map((row, index) => ({
        rank: getStandingRank(row, index),
        team: getStandingTeam(row),
        points: getStandingPoints(row),
      }))
      .filter((row) => row.team && !/^\d+$/.test(String(row.team).trim()))
      .sort((a, b) => Number(a.rank) - Number(b.rank))
  }, [standingsPayload])
  
  const draftPicksByTeam = useMemo(() => {
  const map = new Map()

  for (const pick of sheetDraftPicks) {
    const team = pick?.team || "—"
    if (!map.has(team)) map.set(team, [])
    map.get(team).push(pick)
  }

  return [...map.entries()]
    .map(([team, picks]) => ({
      team,
      picks: [...picks].sort((a, b) => Number(a.overall) - Number(b.overall)),
    }))
    .sort((a, b) => a.team.localeCompare(b.team))
}, [sheetDraftPicks])

  const champion = finalStandings[0] || null

 

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
      <div style={{ marginBottom: 16 }}>
        <Link to="/sideleagues" style={{ color: "#ea580c", fontWeight: 700 }}>
          ← Back to Sideleagues
        </Link>
      </div>

      <section
        style={{
          background: "#ffffff",
          border: "1px solid #fed7aa",
          borderRadius: 24,
          padding: 24,
          marginBottom: 20,
        }}
      >
        <div style={eyebrow}>Sideleague</div>

        <h1 style={{ margin: "14px 0 8px", fontSize: "clamp(28px, 4vw, 40px)" }}>
          {sideleague?.name || "Sideleague"}
        </h1>

        <p style={{ margin: 0, color: "#6b7280", lineHeight: 1.6 }}>
          {sideleague?.description || ""}
        </p>

        <div style={{ marginTop: 8, color: "#6b7280", fontWeight: 600 }}>
          Year: {sideleague?.seasonLabel || "—"}
        </div>

        {sideleague?.view === "matchup_rosters" ? (
          <RulesStrip categories={rulesData.categories} />
        ) : null}
      </section>

      {loading ? (
  <div style={box}>Loading sideleague...</div>
) : error ? (
  <div style={errorBox}>{error}</div>
) : sideleague?.view === "sheet_league" ? (
  <>
    <section
      style={{
        background: "#ffffff",
        border: "1px solid #fed7aa",
        borderRadius: 24,
        padding: 24,
        marginBottom: 20,
      }}
    >
      <div style={{ color: "#f97316", fontWeight: 800, marginBottom: 12 }}>
        Euroleague
      </div>

      <h2 style={{ margin: "0 0 8px", fontSize: 28, color: "#111827" }}>
        {sideleague?.name || "Euroleague"}
      </h2>

      <div style={{ color: "#6b7280", fontWeight: 600 }}>
        Season: {sideleague?.seasonLabel || "—"}
      </div>

      <div style={{ marginTop: 16, color: "#6b7280", lineHeight: 1.7 }}>
        Champion: <strong>{sheetResults?.champion || "—"}</strong>
        <br />
        Runner-up: <strong>{sheetResults?.runnerUp || "—"}</strong>
      </div>
    </section>

    <section style={sectionCard}>
  <div
    style={{
      display: "flex",
      gap: 10,
      marginBottom: 18,
      flexWrap: "wrap",
    }}
  >
    <button
      type="button"
      onClick={() => setSheetTab("matchups")}
      style={{
        padding: "10px 16px",
        borderRadius: 999,
        border: sheetTab === "matchups" ? "1px solid #fb923c" : "1px solid #fed7aa",
        background: sheetTab === "matchups" ? "#f97316" : "#fff7ed",
        color: sheetTab === "matchups" ? "#ffffff" : "#9a3412",
        fontWeight: 800,
        cursor: "pointer",
      }}
    >
      Matchups
    </button>

    <button
      type="button"
      onClick={() => setSheetTab("draft")}
      style={{
        padding: "10px 16px",
        borderRadius: 999,
        border: sheetTab === "draft" ? "1px solid #fb923c" : "1px solid #fed7aa",
        background: sheetTab === "draft" ? "#f97316" : "#fff7ed",
        color: sheetTab === "draft" ? "#ffffff" : "#9a3412",
        fontWeight: 800,
        cursor: "pointer",
      }}
    >
      Draft
    </button>


  </div>

  {sheetTab === "matchups" ? (
  <>
    <h2 style={{ margin: "0 0 14px", fontSize: 24 }}>Matchups</h2>

    {!groupedSheetMatchups.length ? (
      <div style={{ color: "#6b7280" }}>No matchups found.</div>
    ) : (
      <div style={{ display: "grid", gap: 24 }}>
        {groupedSheetMatchups.map((group) => {
          const items = Array.isArray(group.items) ? group.items : []

          if (group.phaseKey === "FINAL FOUR") {
            const finalMatch =
              items.find((item) => normalizeSheetText(item.round).toUpperCase() === "FINAL") || null

            const semifinals = items.filter((item) =>
              normalizeSheetText(item.round).toUpperCase().startsWith("SEMIFINAL")
            )

            return (
              <section key={group.phaseKey}>
                <div style={{ color: "#111827", fontWeight: 900, fontSize: 22, marginBottom: 12 }}>
                  {group.phase}
                </div>

                <div style={{ display: "grid", gap: 16 }}>
                  {finalMatch ? (
                    <div style={{ maxWidth: 760 }}>
                      <EuroleagueMatchupCard matchup={finalMatch} />
                    </div>
                  ) : null}

                  {semifinals.length ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 16,
                      }}
                    >
                      {semifinals.map((matchup, idx) => (
                        <EuroleagueMatchupCard
                          key={`${group.phaseKey}-${matchup.round}-${idx}`}
                          matchup={matchup}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>
            )
          }

          if (group.phaseKey === "PLAYOFFS") {
            return (
              <section key={group.phaseKey}>
                <div style={{ color: "#111827", fontWeight: 900, fontSize: 22, marginBottom: 12 }}>
                  {group.phase}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 16,
                  }}
                >
                  {items.map((matchup, idx) => (
                    <EuroleagueMatchupCard
                      key={`${group.phaseKey}-${matchup.round}-${idx}`}
                      matchup={matchup}
                    />
                  ))}
                </div>
              </section>
            )
          }

          if (group.phaseKey === "PLAY-IN") {
            return (
              <section key={group.phaseKey}>
                <div style={{ color: "#111827", fontWeight: 900, fontSize: 22, marginBottom: 12 }}>
                  {group.phase}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 16,
                  }}
                >
                  {items.map((matchup, idx) => (
                    <EuroleagueMatchupCard
                      key={`${group.phaseKey}-${matchup.round}-${idx}`}
                      matchup={matchup}
                    />
                  ))}
                </div>
              </section>
            )
          }

          return null
        })}
      </div>
    )}
  </>
) : sheetTab === "draft" ? (
  <>
    <div
      style={{
        display: "flex",
        gap: 10,
        marginBottom: 18,
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={() => setDraftView("byPick")}
        style={{
          padding: "8px 14px",
          borderRadius: 999,
          border: draftView === "byPick" ? "1px solid #fb923c" : "1px solid #fed7aa",
          background: draftView === "byPick" ? "#f97316" : "#fff7ed",
          color: draftView === "byPick" ? "#ffffff" : "#9a3412",
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        By Pick
      </button>

      <button
        type="button"
        onClick={() => setDraftView("byTeam")}
        style={{
          padding: "8px 14px",
          borderRadius: 999,
          border: draftView === "byTeam" ? "1px solid #fb923c" : "1px solid #fed7aa",
          background: draftView === "byTeam" ? "#f97316" : "#fff7ed",
          color: draftView === "byTeam" ? "#ffffff" : "#9a3412",
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        By Team
      </button>
    </div>

    <h2 style={{ margin: "0 0 14px", fontSize: 24 }}>Draft Results</h2>

    {!sheetDraftPicks.length ? (
      <div style={{ color: "#6b7280" }}>No draft results found.</div>
    ) : draftView === "byPick" ? (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Rnd</th>
              <th style={th}>Ovr</th>
              <th style={th}>Team</th>
              <th style={th}>Player</th>
              <th style={th}>Club</th>
            </tr>
          </thead>
          <tbody>
            {sheetDraftPicks.map((pick) => (
              <tr key={`${pick.round}-${pick.overall}`}>
                <td style={td}>{formatDraftRoundLabel(pick.round) || "—"}</td>
                <td style={td}>{pick.overall}</td>
                <td style={td}>{pick.team}</td>
                <td style={td}>{pick.player}</td>
                <td style={td}>{pick.club}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 16,
        }}
      >
        {draftPicksByTeam.map((entry) => (
          <section
            key={entry.team}
            style={{
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              borderRadius: 20,
              padding: 18,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 900, color: "#111827", marginBottom: 10 }}>
              {entry.team}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Rnd</th>
                    <th style={th}>Ovr</th>
                    <th style={th}>Player</th>
                    <th style={th}>Club</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.picks.map((pick) => (
                    <tr key={`${entry.team}-${pick.round}-${pick.overall}`}>
                      <td style={td}>{formatDraftRoundLabel(pick.round) || "—"}</td>
                      <td style={td}>{pick.overall}</td>
                      <td style={td}>{pick.player}</td>
                      <td style={td}>{pick.club}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    )}
  </>
) : null}

</section>
  </>
) : sideleague?.view === "final_standings" ? (
  <>
    <ChampionCard champion={champion} seasonLabel={sideleague?.seasonLabel} />
    <FinalStandingsCard rows={finalStandings} />
  </>
) : (
  <>
    <section
      style={{
        background: "#ffffff",
        border: "1px solid #fed7aa",
        borderRadius: 24,
        padding: 24,
        marginBottom: 20,
      }}
    >
      <div style={{ color: "#f97316", fontWeight: 800, marginBottom: 12 }}>
        Final Result
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 16,
        }}
      >
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 20,
            padding: 18,
          }}
        >
          <div style={{ color: "#f97316", fontWeight: 800, fontSize: 13, marginBottom: 8 }}>
            WINNER
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div
              style={{
                fontSize: 30,
                lineHeight: 1.1,
                fontWeight: 900,
                color: "#111827",
                minWidth: 0,
              }}
            >
              <SideleagueTeamLink teamName={computedWinnerTeam?.name || "—"} />
            </div>

            <div
              style={{
                fontSize: 46,
                lineHeight: 1,
                fontWeight: 900,
                color: "#f97316",
                flexShrink: 0,
              }}
            >
              {winnerScore ?? "—"}
            </div>
          </div>

          <TeamStatsStrip
            teamStats={computedWinnerTeam?.stats || {}}
            opponentStats={computedLoserTeam?.stats || {}}
            scoringCategories={rulesData.categories}
          />
        </div>

        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 20,
            padding: 18,
          }}
        >
          <div style={{ color: "#f97316", fontWeight: 800, fontSize: 13, marginBottom: 8 }}>
            LOSER
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div
              style={{
                fontSize: 30,
                lineHeight: 1.1,
                fontWeight: 900,
                color: "#111827",
                minWidth: 0,
              }}
            >
              <SideleagueTeamLink teamName={computedLoserTeam?.name || "—"} />
            </div>

            <div
              style={{
                fontSize: 46,
                lineHeight: 1,
                fontWeight: 900,
                color: "#f97316",
                flexShrink: 0,
              }}
            >
              {loserScore ?? "—"}
            </div>
          </div>

          <TeamStatsStrip
            teamStats={computedLoserTeam?.stats || {}}
            opponentStats={computedWinnerTeam?.stats || {}}
            scoringCategories={rulesData.categories}
          />
        </div>
      </div>
    </section>



    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 20,
      }}
    >
      <TeamRosterCard
        title={southLiveTeam?.name || sideleague?.teams?.[0] || "South"}
        rows={southRoster}
      />
      <TeamRosterCard
        title={northLiveTeam?.name || sideleague?.teams?.[1] || "North"}
        rows={northRoster}
      />
    </section>
  </>
)}
    </main>
  )
}

const box = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 18,
}

const errorBox = {
  ...box,
  color: "#b91c1c",
  background: "#fff7f7",
  border: "1px solid #fecaca",
}