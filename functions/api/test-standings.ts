// functions/api/test-standings.ts
interface Env {}

interface PagesContext {
  request: Request
  env: Env
}

export const onRequestGet = async ({
  request,
}: PagesContext): Promise<Response> => {
  const url = new URL(request.url)
  const leagueId = url.searchParams.get("leagueId")

  if (!leagueId) {
    return new Response(JSON.stringify({ error: "Missing leagueId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const fantraxUrl = `https://www.fantrax.com/fxea/general/getStandings?leagueId=${encodeURIComponent(leagueId)}`

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
    },
  })
}