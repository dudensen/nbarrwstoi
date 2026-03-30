// functions/api/standings.ts
export const onRequestGet = async ({ request }: any) => {
  const url = new URL(request.url)
  const season = url.searchParams.get("season") || "2025-26"

  const seasonMap: Record<string, string> = {
    "2025-26": "tl6muagkmafhimxi",
    "2024-25": "OLDER_LEAGUE_ID",
  }

  const leagueId = seasonMap[season]
  if (!leagueId) {
    return new Response(JSON.stringify({ error: "Unknown season" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const fantraxUrl = `https://www.fantrax.com/fxea/general/getStandings?leagueId=${leagueId}`
  const resp = await fetch(fantraxUrl)
  const data = await resp.json()

  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  })
}