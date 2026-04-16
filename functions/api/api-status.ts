import { SEASONS } from "../../src/config/seasons"

interface PagesContext {
  request: Request
}

type CheckResult = {
  key: string
  label: string
  url: string
  ok: boolean
  status: number | null
  message: string
}

function isMeaningfullyEmpty(data: unknown): boolean {
  if (data == null) return true
  if (Array.isArray(data)) return data.length === 0
  if (typeof data === "object") return Object.keys(data as Record<string, unknown>).length === 0
  if (typeof data === "string") return data.trim().length === 0
  return false
}

async function runCheck(
  key: string,
  label: string,
  url: string
): Promise<CheckResult> {
  try {
    const resp = await fetch(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "Mozilla/5.0",
      },
    })

    const text = await resp.text()
    const status = resp.status

    if (!resp.ok) {
      return {
        key,
        label,
        url,
        ok: false,
        status,
        message: `HTTP ${status}`,
      }
    }

    if (!text.trim()) {
      return {
        key,
        label,
        url,
        ok: false,
        status,
        message: "Empty body",
      }
    }

    let parsed: unknown = null

    try {
      parsed = JSON.parse(text)
    } catch {
      return {
        key,
        label,
        url,
        ok: false,
        status,
        message: "Invalid JSON",
      }
    }

    if (isMeaningfullyEmpty(parsed)) {
      return {
        key,
        label,
        url,
        ok: false,
        status,
        message: "Empty JSON payload",
      }
    }

    return {
      key,
      label,
      url,
      ok: true,
      status,
      message: "OK",
    }
  } catch (error) {
    return {
      key,
      label,
      url,
      ok: false,
      status: null,
      message: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export const onRequestGet = async (_ctx: PagesContext): Promise<Response> => {
  const currentSeason =
    SEASONS.find((season) => season.isCurrent) ||
    SEASONS[0]

  const leagueId = currentSeason?.leagueId || ""

  const checks = await Promise.all([
    runCheck(
      "adp",
      "ADP",
      "https://www.fantrax.com/fxea/general/getAdp?sport=NBA"
    ),
    runCheck(
      "leagueInfo",
      "League Info",
      `https://www.fantrax.com/fxea/league/getLeagueInfo?leagueId=${encodeURIComponent(leagueId)}`
    ),
    runCheck(
      "standings",
      "Standings",
      `https://www.fantrax.com/fxea/league/getStandings?leagueId=${encodeURIComponent(leagueId)}`
    ),
    runCheck(
      "draftPicks",
      "Draft Picks",
      `https://www.fantrax.com/fxea/general/getDraftPicks?leagueId=${encodeURIComponent(leagueId)}`
    ),
    runCheck(
        "playerIds",
        "Player IDs",
        "https://www.fantrax.com/fxea/general/getPlayerIds?sport=NBA"
        ),
    runCheck(
        "draftResults",
        "Draft Results",
        `https://www.fantrax.com/fxea/general/getDraftPicks?leagueId=${encodeURIComponent(leagueId)}`
    ),


  ])

  return new Response(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        season: currentSeason?.key || null,
        leagueId: leagueId || null,
        checks,
      },
      null,
      2
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  )
}