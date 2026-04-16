export function decodeMaybeBrokenText(value) {
  if (typeof value !== "string") return value ?? ""
  try {
    return decodeURIComponent(escape(value))
  } catch {
    return value
  }
}

export function extractTeamsFromLeagueInfo(leagueInfo) {
  const seen = new Map()

  const addTeam = (team) => {
    if (!team?.id) return
    if (!seen.has(team.id)) {
      seen.set(team.id, {
        id: team.id,
        name: decodeMaybeBrokenText(team.name || ""),
        shortName: decodeMaybeBrokenText(team.shortName || ""),
        ...team,
      })
    }
  }

  for (const period of leagueInfo?.matchups || []) {
    for (const matchup of period?.matchupList || []) {
      addTeam(matchup.away)
      addTeam(matchup.home)
    }
  }

  return Array.from(seen.values()).sort((a, b) =>
    String(a.name).localeCompare(String(b.name))
  )
}

export function getTeamByIdFromLeagueInfo(leagueInfo, teamId) {
  return (
    extractTeamsFromLeagueInfo(leagueInfo).find((team) => team.id === teamId) ||
    null
  )
}

export function getTeamMatchups(leagueInfo, teamId) {
  const rows = []

  for (const period of leagueInfo?.matchups || []) {
    for (const matchup of period?.matchupList || []) {
      const away = matchup?.away
      const home = matchup?.home

      if (away?.id === teamId || home?.id === teamId) {
        const isHome = home?.id === teamId
        const opponent = isHome ? away : home

        rows.push({
          period: period.period,
          venue: isHome ? "Home" : "Away",
          opponentId: opponent?.id || "",
          opponentName: decodeMaybeBrokenText(opponent?.name || ""),
          opponentShortName: decodeMaybeBrokenText(opponent?.shortName || ""),
        })
      }
    }
  }

  return rows.sort((a, b) => a.period - b.period)
}

export function buildPlayerLookupFromAdp(adpRows = []) {
  const map = new Map()

  for (const row of adpRows) {
    const id = cleanFantraxPlayerId(row?.id || "")
    if (!id) continue

    map.set(id, {
      id,
      name: decodeMaybeBrokenText(row?.name || id),
      pos: row?.pos || "",
      adp: row?.ADP ?? null,
      raw: row,
    })
  }

  return map
}

export function parsePlayerCsv(text = "") {
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

  if (!rows.length) return []

  const headers = rows[0].map((h) => String(h || "").trim())

  return rows.slice(1).map((row) => {
    const obj = {}
    headers.forEach((header, idx) => {
      obj[header] = row[idx] ?? ""
    })
    return obj
  })
}

export function cleanFantraxPlayerId(value) {
  return String(value ?? "").trim().replace(/^\*+|\*+$/g, "")
}

export function buildPlayerLookupFromCsvRows(csvRows = []) {
  const map = new Map()

  for (const row of csvRows) {
    const id = cleanFantraxPlayerId(row?.ID)
    if (!id) continue

    map.set(id, {
      id,
      name: decodeMaybeBrokenText(row?.Player || id),
      pos: row?.Position || "",
      team: row?.Team || "",
      raw: row,
    })
  }

  return map
}

export function mergePlayerLookups(...maps) {
  const merged = new Map()

  for (const map of maps) {
    if (!(map instanceof Map)) continue

    for (const [id, player] of map.entries()) {
      const existing = merged.get(id)

      if (!existing) {
        merged.set(id, player)
        continue
      }

      merged.set(id, {
        ...existing,
        ...player,
        id,
        name: existing?.name || player?.name || id,
        pos: existing?.pos || player?.pos || "",
        adp: existing?.adp ?? player?.adp ?? null,
      })
    }
  }

  return merged
}

export function getRosterItemPlayerId(item) {
  return cleanFantraxPlayerId(
    item?.player?.id ||
      item?.playerId ||
      item?.entityId ||
      item?.entity?.id ||
      item?.id ||
      ""
  )
}

export function getRosterItemPlayerName(item) {
  return decodeMaybeBrokenText(
    item?.player?.name ||
      item?.playerName ||
      item?.name ||
      item?.entity?.name ||
      item?.player?.fullName ||
      [item?.player?.firstName, item?.player?.lastName].filter(Boolean).join(" ") ||
      ""
  )
}

export function getRosterItemPlayerPos(item) {
  return String(
    item?.player?.pos ||
      item?.player?.position ||
      item?.pos ||
      item?.position ||
      item?.entity?.pos ||
      item?.entity?.position ||
      ""
  ).trim()
}

export function getRosterForTeam(teamRostersResponse, teamId) {
  const roster = teamRostersResponse?.rosters?.[teamId]

  return roster?.rosterItems || roster?.players || roster?.items || []
}

export function enrichRosterItems(rosterItems = [], playerLookup) {
  return rosterItems.map((item) => {
    const rawId = String(item?.id || "")
    const playerId = getRosterItemPlayerId(item)
    const fallbackName = getRosterItemPlayerName(item)
    const fallbackPos = getRosterItemPlayerPos(item)

    const player =
      playerLookup.get(playerId) ||
      playerLookup.get(rawId) ||
      null

    return {
      ...item,
      id: playerId || rawId,
      playerName: player?.name || fallbackName || playerId || rawId || "—",
      playerPos: player?.pos || fallbackPos || "",
      playerAdp: player?.adp ?? null,
    }
  })
}

export function getTeamNameMapFromRosters(teamRostersResponse) {
  const map = new Map()

  const rosters = teamRostersResponse?.rosters || {}
  for (const [teamId, teamData] of Object.entries(rosters)) {
    map.set(teamId, teamData?.teamName || teamId)
  }

  return map
}

export function enrichDraftPicks(draftResults, playerLookup, teamNameMap) {
  const picks = draftResults?.draftPicks || []

  return picks.map((pick) => {
    const player = pick?.playerId
      ? playerLookup.get(cleanFantraxPlayerId(String(pick.playerId)))
      : null
    const teamName = teamNameMap.get(pick.teamId) || pick.teamId

    return {
      ...pick,
      teamName,
      playerName: player?.name || (pick.playerId ? pick.playerId : "No selection"),
      playerPos: player?.pos || "",
      playerAdp: player?.adp ?? null,
      madePick: Boolean(pick?.playerId),
    }
  })
}

export function getPlayerTeamMapFromRosters(teamRostersResponse) {
  const map = new Map()
  const rosters = teamRostersResponse?.rosters || {}

  for (const teamData of Object.values(rosters)) {
    const teamName = teamData?.teamName || "Unknown Team"
    const rosterItems =
      teamData?.rosterItems || teamData?.players || teamData?.items || []

    for (const item of rosterItems) {
      const playerId = getRosterItemPlayerId(item)
      if (!playerId) continue
      map.set(playerId, teamName)
    }
  }

  return map
}

export function slugifyTeamName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function getTeamBySlugFromLeagueInfo(leagueInfo, teamSlug) {
  const teams = extractTeamsFromLeagueInfo(leagueInfo)
  return teams.find((team) => slugifyTeamName(team?.name) === teamSlug) || null
}