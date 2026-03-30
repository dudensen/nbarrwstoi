import { fetchJson } from '../utils/fetchJson'

export function fetchLeagueInfo(seasonKey) {
  return fetchJson(`/api/league-info?season=${encodeURIComponent(seasonKey)}`)
}

export function fetchStandings(seasonKey) {
  return fetchJson(`/api/standings?season=${encodeURIComponent(seasonKey)}`)
}

export function fetchRosters(seasonKey) {
  return fetchJson(`/api/rosters?season=${encodeURIComponent(seasonKey)}`)
}

export function fetchDraftPicks(seasonKey) {
  return fetchJson(`/api/draft-picks?season=${encodeURIComponent(seasonKey)}`)
}

export function fetchSpreadsheet(kind, seasonKey) {
  return fetchJson(`/api/spreadsheet?kind=${encodeURIComponent(kind)}&season=${encodeURIComponent(seasonKey)}`)
}
