import { fetchFantrax, getSeasonConfig, json } from './_shared'

export async function onRequestGet(context) {
  try {
    const { config, url } = getSeasonConfig(context.request)
    const period = url.searchParams.get('period')
    const endpoint = period
      ? `getTeamRosters?leagueId=${encodeURIComponent(config.leagueId)}&period=${encodeURIComponent(period)}`
      : null

    const data = endpoint
      ? await (await fetch(`https://www.fantrax.com/fxea/general/${endpoint}`)).json()
      : await fetchFantrax('getTeamRosters', config.leagueId)

    return json(data)
  } catch (error) {
    return json({ error: error.message || 'Failed to load rosters' }, { status: 500 })
  }
}
