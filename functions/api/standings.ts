import { getSeasonByKey } from "../../src/config/seasons"

interface PagesContext {
  request: Request
}

export const onRequestGet = async ({
  request,
}: PagesContext): Promise<Response> => {
  try {
    const url = new URL(request.url)
    const seasonKey = url.searchParams.get("season") || "2025-26"

    const season = getSeasonByKey(seasonKey)

    if (!season?.leagueId) {
      return new Response(
        JSON.stringify({ error: `Unknown season: ${seasonKey}` }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      )
    }

    const fantraxUrl = `https://www.fantrax.com/fxea/general/getStandings?leagueId=${encodeURIComponent(season.leagueId)}`

    const resp = await fetch(fantraxUrl, {
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "Mozilla/5.0",
      },
    })

    const text = await resp.text()

    return new Response(text, {
      status: resp.status,
      headers: {
        "Content-Type": resp.headers.get("content-type") || "application/json",
        "Cache-Control": "public, max-age=300",
      },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}