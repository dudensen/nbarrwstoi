const FANTRAX_BASE = 'https://www.fantrax.com/fxea/general'

const SEASONS = {
  '2025-26': {
    leagueId: 'tl6muagkmafhimxi',
    spreadsheets: {
      history: { sheetId: 'YOUR_HISTORY_SHEET_ID', gid: '0' },
      champions: { sheetId: 'YOUR_CHAMPIONS_SHEET_ID', gid: '0' },
    },
  },
  '2024-25': {
    leagueId: 'REPLACE_WITH_OLDER_SEASON_ID',
    spreadsheets: {
      history: { sheetId: 'YOUR_HISTORY_SHEET_ID', gid: '0' },
      champions: { sheetId: 'YOUR_CHAMPIONS_SHEET_ID', gid: '0' },
    },
  },
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      ...(init.headers || {}),
    },
    status: init.status || 200,
  })
}

export function getSeasonConfig(request) {
  const url = new URL(request.url)
  const seasonKey = url.searchParams.get('season') || '2025-26'
  const config = SEASONS[seasonKey]

  if (!config) {
    throw new Error(`Unknown season: ${seasonKey}`)
  }

  return { seasonKey, config, url }
}

export async function fetchFantrax(endpoint, leagueId) {
  const response = await fetch(`${FANTRAX_BASE}/${endpoint}?leagueId=${encodeURIComponent(leagueId)}`)

  if (!response.ok) {
    throw new Error(`Fantrax request failed with status ${response.status}`)
  }

  return response.json()
}

export function parseCsv(text) {
  const rows = []
  let current = []
  let value = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      current.push(value)
      value = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1
      current.push(value)
      if (current.some((cell) => String(cell).trim() !== '')) {
        rows.push(current)
      }
      current = []
      value = ''
      continue
    }

    value += char
  }

  if (value.length > 0 || current.length > 0) {
    current.push(value)
    rows.push(current)
  }

  return rows
}

export async function fetchPublicSheetCsv(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Spreadsheet request failed with status ${response.status}`)
  }

  const csv = await response.text()
  const rows = parseCsv(csv)
  const headers = rows[0] || []
  const body = rows.slice(1).map((row) => {
    const entry = {}
    headers.forEach((header, index) => {
      entry[header || `Column ${index + 1}`] = row[index] ?? ''
    })
    return entry
  })

  return { headers, rows: body }
}
