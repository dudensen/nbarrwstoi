const TEAM_ALIASES = {
  "samarina dudenbros2": "Samarina Dudenbros",
  "karafli saita": "Karafli Saita",
  "karafli shaita": "Karafli Saita",
}

const PHASE_ALIASES = {
  regular: "Regular",
  playoffs: "Playoffs",
  playoff: "Playoffs",
}

function s(value) {
  return String(value ?? "").replace(/\r/g, "").trim()
}

function num(value) {
  if (value == null || value === "") return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function ratio(value, total) {
  if (!Number.isFinite(total) || total === 0) return 0
  return value / total
}

function compareText(a, b) {
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

export function getHistoricalTeamProfile(rows = [], teamSlug = "") {
  const normalizedRows = normalizeHistoryRows(rows)
  const targetSlug = String(teamSlug || "").trim().toLowerCase()
  if (!targetSlug) return null

  const matchingRows = normalizedRows.filter(
    (row) => slugifyTeamName(canonicalTeamName(row.team)) === targetSlug
  )

  if (!matchingRows.length) return null

  const team = canonicalTeamName(matchingRows[0].team)

  const firstYear = Math.min(...matchingRows.map((row) => row.year))
  const lastYear = Math.max(...matchingRows.map((row) => row.year))

  const managerCounts = new Map()
  for (const row of matchingRows) {
    const manager = s(row.manager)
    if (!manager) continue
    managerCounts.set(manager, (managerCounts.get(manager) || 0) + 1)
  }

  let manager = ""
  let bestCount = -1
  for (const [name, count] of managerCounts.entries()) {
    if (count > bestCount) {
      manager = name
      bestCount = count
    }
  }

  const totalMatches = matchingRows.length
  const totalGamesWon = matchingRows.reduce((sum, row) => sum + row.gamesWon, 0)
  const totalWins = matchingRows.reduce((sum, row) => sum + row.wins, 0)
  const totalLosses = matchingRows.reduce((sum, row) => sum + row.losses, 0)
  const totalTies = matchingRows.reduce((sum, row) => sum + row.ties, 0)

  const regularRows = matchingRows.filter((row) => row.phase === "Regular")
  const playoffRows = matchingRows.filter((row) => row.phase === "Playoffs")

  const seasonMap = new Map()
  for (const row of matchingRows) {
    if (!seasonMap.has(row.year)) {
      seasonMap.set(row.year, {
        year: row.year,
        matches: 0,
        gamesWon: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        regularMatches: 0,
        playoffMatches: 0,
      })
    }

    const item = seasonMap.get(row.year)
    item.matches += 1
    item.gamesWon += row.gamesWon
    item.wins += row.wins
    item.losses += row.losses
    item.ties += row.ties
    if (row.phase === "Regular") item.regularMatches += 1
    if (row.phase === "Playoffs") item.playoffMatches += 1
  }

  const seasons = Array.from(seasonMap.values()).sort((a, b) => a.year - b.year)

  return {
    team,
    manager,
    firstYear,
    lastYear,
    matches: totalMatches,
    gamesWon: totalGamesWon,
    wins: totalWins,
    losses: totalLosses,
    ties: totalTies,
    regularMatches: regularRows.length,
    playoffMatches: playoffRows.length,
    seasons,
    rows: matchingRows,
  }
}

function normalizeAliasKey(value) {
  return s(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
}

export function canonicalTeamName(value) {
  const clean = s(value)
  return TEAM_ALIASES[normalizeAliasKey(clean)] || clean
}

export function slugifyTeamName(value) {
  return canonicalTeamName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function canonicalPhase(value) {
  const clean = s(value).toLowerCase()
  return PHASE_ALIASES[clean] || s(value)
}

function canonicalManagerName(value) {
  return s(value)
}

function getOpponentRaw(row = {}) {
  return (
    row.opponent ||
    row["vs Opponent"] ||
    row.vsOpponent ||
    row["vs_Opponent"] ||
    ""
  )
}

function getOpponentManagerRaw(row = {}) {
  return (
    row.opponentManager ||
    row["vs Manager"] ||
    row.vsManager ||
    ""
  )
}

export function normalizeHistoryRow(row = {}, index = 0) {
  const team = canonicalTeamName(row.team || row.Team)

  const opponent = canonicalTeamName(
    s(getOpponentRaw(row)).replace(/^vs\s+/i, "")
  )

  const manager = canonicalManagerName(row.manager || row.Manager || "")
  const opponentManager = canonicalManagerName(
    s(getOpponentManagerRaw(row)).replace(/^vs\s+/i, "")
  )

  return {
    rowId:
      row.rowId ||
      `${num(row.year ?? row.Year)}-${canonicalPhase(
        row.phase ?? row["Regular/Playoffs"] ?? row["Regular/\nPlayoffs"]
      )}-${num(row.period ?? row.Period)}-${num(row.matchNo ?? row["Match No"])}-${team}-${opponent}-${index}`,

    year: num(row.year ?? row.Year),
    phase: canonicalPhase(
      row.phase ?? row["Regular/Playoffs"] ?? row["Regular/\nPlayoffs"]
    ),
    period: num(row.period ?? row.Period),
    matchNo: num(row.matchNo ?? row["Match No"]),
    team,
    manager,
    gamesWon: num(row.gamesWon ?? row["Games Won"]),
    wins: num(row.wins ?? row.W),
    losses: num(row.losses ?? row.L),
    ties: num(row.ties ?? row.D),
    opponent,
    opponentManager,
    fgm: num(row.fgm ?? row.FGM),
    fgPct: num(row.fgPct ?? row["FG%"]),
    threePm: num(row.threePm ?? row["3PM"]),
    threePct: num(row.threePct ?? row["3P%"]),
    ftPct: num(row.ftPct ?? row["FT%"]),
    pts: num(row.pts ?? row.PTS),
    oreb: num(row.oreb ?? row.OREB),
    dreb: num(row.dreb ?? row.DREB),
    ast: num(row.ast ?? row.AST),
    stl: num(row.stl ?? row.STL),
    blk: num(row.blk ?? row.BLK),
    turnovers: num(row.turnovers ?? row.to ?? row.TO),
    ato: num(row.ato ?? row["A/TO"]),
  }
}

export function normalizeHistoryRows(rows = []) {
  return rows
    .map((row, index) => normalizeHistoryRow(row, index))
    .filter((row) => row.team && row.opponent && row.year)
}

function aggregateTeamRows(rows = []) {
  const byTeam = new Map()

  for (const row of rows) {
    const key = row.team

    if (!byTeam.has(key)) {
      byTeam.set(key, {
        team: row.team,
        firstYear: row.year,
        lastYear: row.year,
        matches: 0,
        gamesWon: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        fgm: 0,
        fgPctSum: 0,
        fgPctCount: 0,
        threePm: 0,
        threePctSum: 0,
        threePctCount: 0,
        ftPctSum: 0,
        ftPctCount: 0,
        pts: 0,
        oreb: 0,
        dreb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        turnovers: 0,
        atoSum: 0,
        atoCount: 0,
      })
    }

    const item = byTeam.get(key)
    item.firstYear = Math.min(item.firstYear, row.year)
    item.lastYear = Math.max(item.lastYear, row.year)
    item.matches += 1
    item.gamesWon += row.gamesWon
    item.wins += row.wins
    item.losses += row.losses
    item.ties += row.ties
    item.fgm += row.fgm
    item.threePm += row.threePm
    item.pts += row.pts
    item.oreb += row.oreb
    item.dreb += row.dreb
    item.ast += row.ast
    item.stl += row.stl
    item.blk += row.blk
    item.turnovers += row.turnovers

    if (row.fgPct) {
      item.fgPctSum += row.fgPct
      item.fgPctCount += 1
    }
    if (row.threePct) {
      item.threePctSum += row.threePct
      item.threePctCount += 1
    }
    if (row.ftPct) {
      item.ftPctSum += row.ftPct
      item.ftPctCount += 1
    }
    if (row.ato) {
      item.atoSum += row.ato
      item.atoCount += 1
    }
  }

  return Array.from(byTeam.values())
    .map((item) => {
      const categoryTotal = item.wins + item.losses + item.ties
      return {
        ...item,
        gameWinPct: ratio(item.gamesWon, item.matches),
        categoryWinPct: ratio(item.wins + 0.5 * item.ties, categoryTotal),
        fgPctAvg: ratio(item.fgPctSum, item.fgPctCount),
        threePctAvg: ratio(item.threePctSum, item.threePctCount),
        ftPctAvg: ratio(item.ftPctSum, item.ftPctCount),
        atoAvg: ratio(item.atoSum, item.atoCount),
      }
    })
    .sort((a, b) => {
      if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon
      if (b.gameWinPct !== a.gameWinPct) return b.gameWinPct - a.gameWinPct
      if (b.categoryWinPct !== a.categoryWinPct) return b.categoryWinPct - a.categoryWinPct
      return compareText(a.team, b.team)
    })
}

export function buildTotalHistory(rows = []) {
  return aggregateTeamRows(normalizeHistoryRows(rows))
}

export function buildRegularHistory(rows = []) {
  return aggregateTeamRows(
    normalizeHistoryRows(rows).filter((row) => row.phase === "Regular")
  )
}

export function buildPlayoffHistory(rows = []) {
  return aggregateTeamRows(
    normalizeHistoryRows(rows).filter((row) => row.phase === "Playoffs")
  )
}

export function buildHeadToHeadSummary(rows = [], selectedTeam = "") {
  const team = canonicalTeamName(selectedTeam)
  if (!team) return []

  const filtered = normalizeHistoryRows(rows).filter((row) => row.team === team)
  const byOpponent = new Map()

  for (const row of filtered) {
    const key = row.opponent

    if (!byOpponent.has(key)) {
      byOpponent.set(key, {
        team,
        opponent: row.opponent,
        matches: 0,
        gamesWon: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        regularMatches: 0,
        playoffMatches: 0,
      })
    }

    const item = byOpponent.get(key)
    item.matches += 1
    item.gamesWon += row.gamesWon
    item.wins += row.wins
    item.losses += row.losses
    item.ties += row.ties

    if (row.phase === "Regular") item.regularMatches += 1
    if (row.phase === "Playoffs") item.playoffMatches += 1
  }

  return Array.from(byOpponent.values())
    .map((item) => {
      const categoryTotal = item.wins + item.losses + item.ties
      return {
        ...item,
        gameWinPct: ratio(item.gamesWon, item.matches),
        categoryWinPct: ratio(item.wins + 0.5 * item.ties, categoryTotal),
      }
    })
    .sort((a, b) => {
      if (b.matches !== a.matches) return b.matches - a.matches
      if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon
      return compareText(a.opponent, b.opponent)
    })
}

export function buildHeadToHeadDetail(rows = [], selectedTeam = "", selectedOpponent = "") {
  const team = canonicalTeamName(selectedTeam)
  const opponent = canonicalTeamName(selectedOpponent)

  if (!team || !opponent) return []

  return normalizeHistoryRows(rows)
    .filter((row) => row.team === team && row.opponent === opponent)
    .sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year
      if (a.phase !== b.phase) return compareText(a.phase, b.phase)
      if (a.period !== b.period) return a.period - b.period
      if (a.matchNo !== b.matchNo) return a.matchNo - b.matchNo
      return compareText(a.rowId, b.rowId)
    })
}

function maxBy(rows, getValue) {
  let best = null
  let bestValue = Number.NEGATIVE_INFINITY

  for (const row of rows) {
    const value = getValue(row)
    if (!Number.isFinite(value)) continue
    if (value > bestValue) {
      bestValue = value
      best = row
    }
  }

  return best
}

export function buildRecords(rows = []) {
  const normalized = normalizeHistoryRows(rows)

  const categories = [
    { key: "wins", label: "Most category wins", value: (r) => r.wins },
    { key: "pts", label: "Most points", value: (r) => r.pts },
    { key: "ast", label: "Most assists", value: (r) => r.ast },
    { key: "stl", label: "Most steals", value: (r) => r.stl },
    { key: "blk", label: "Most blocks", value: (r) => r.blk },
    { key: "fgm", label: "Most field goals made", value: (r) => r.fgm },
    { key: "threePm", label: "Most 3PM", value: (r) => r.threePm },
    { key: "oreb", label: "Most offensive rebounds", value: (r) => r.oreb },
    { key: "dreb", label: "Most defensive rebounds", value: (r) => r.dreb },
    { key: "fgPct", label: "Best FG%", value: (r) => r.fgPct },
    { key: "threePct", label: "Best 3P%", value: (r) => r.threePct },
    { key: "ftPct", label: "Best FT%", value: (r) => r.ftPct },
    { key: "ato", label: "Best A/TO", value: (r) => r.ato },
  ]

  return categories.map((category) => {
    const top = maxBy(normalized, category.value)
    return {
      key: category.key,
      label: category.label,
      top: top
        ? {
            ...top,
            [category.key]: category.value(top),
          }
        : null,
    }
  })
}

export function formatNumber(value, digits = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatPct(value, digits = 3) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return n.toFixed(digits)
}