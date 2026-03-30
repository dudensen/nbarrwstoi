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
  return extractTeamsFromLeagueInfo(leagueInfo).find((team) => team.id === teamId) || null
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
    const id = String(row?.id || "")
    if (!id) continue

    map.set(id, {
      id,
      name: row?.name || id,
      pos: row?.pos || "",
      adp: row?.ADP ?? null,
      raw: row,
    })
  }

  return map
}

export function getRosterForTeam(teamRostersResponse, teamId) {
  return teamRostersResponse?.rosters?.[teamId]?.rosterItems || []
}

export function enrichRosterItems(rosterItems = [], playerLookup) {
  return rosterItems.map((item) => {
    const player = playerLookup.get(String(item.id))

    return {
      ...item,
      playerName: player?.name || item.id,
      playerPos: player?.pos || "",
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
    const player = pick?.playerId ? playerLookup.get(String(pick.playerId)) : null
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
    const rosterItems = teamData?.rosterItems || []

    for (const item of rosterItems) {
      if (!item?.id) continue
      map.set(String(item.id), teamName)
    }
  }

  return map
}