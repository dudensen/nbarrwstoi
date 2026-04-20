interface PagesContext {
  request: Request
}

export const onRequestGet = async ({ request }: PagesContext): Promise<Response> => {
  try {
    const url = new URL(request.url)
    const leagueId = url.searchParams.get("leagueId") || ""

    if (!leagueId) {
      return new Response(JSON.stringify({ error: "Missing leagueId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    const fantraxUrl = `https://www.fantrax.com/fxea/general/getDraftResults?leagueId=${encodeURIComponent(
      leagueId
    )}`

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
        "Cache-Control": "public, max-age=60",
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