import { fetchPublicSheetCsv, getSeasonConfig, json } from './_shared'

export async function onRequestGet(context) {
  try {
    const { config, url } = getSeasonConfig(context.request)
    const kind = url.searchParams.get('kind') || 'history'
    const source = config.spreadsheets?.[kind]

    if (!source?.sheetId || !source?.gid || String(source.sheetId).startsWith('YOUR_')) {
      return json({ headers: [], rows: [] })
    }

    const data = await fetchPublicSheetCsv(source.sheetId, source.gid)
    return json(data)
  } catch (error) {
    return json({ error: error.message || 'Failed to load spreadsheet data' }, { status: 500 })
  }
}
