interface PagesContext {
  request: Request
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  })
}

async function fetchText(url: string) {
  const resp = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "user-agent": "Mozilla/5.0",
    },
  })

  const text = await resp.text()

  return {
    ok: resp.ok,
    status: resp.status,
    text,
    contentType: resp.headers.get("content-type") || "application/json",
  }
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const onRequestGet = async ({ request }: PagesContext): Promise<Response> => {
  try {
    const url = new URL(request.url)
    const leagueId = url.searchParams.get("leagueId") || ""
    const period = url.searchParams.get("period") || "1"

    if (!leagueId) {
      return jsonResponse({ error: "Missing leagueId" }, 400)
    }

    const leagueInfoUrl =
      `https://www.fantrax.com/fxea/general/getLeagueInfo?leagueId=${encodeURIComponent(leagueId)}`

    const rostersUrl =
      `https://www.fantrax.com/fxea/general/getTeamRosters?leagueId=${encodeURIComponent(leagueId)}&period=${encodeURIComponent(period)}`

    const standingsUrl =
      `https://www.fantrax.com/fxea/general/getStandings?leagueId=${encodeURIComponent(leagueId)}`

    const [leagueInfoResp, rostersResp, standingsResp] = await Promise.all([
      fetchText(leagueInfoUrl),
      fetchText(rostersUrl),
      fetchText(standingsUrl),
    ])

    const leagueInfo = safeJsonParse(leagueInfoResp.text)
    const rosters = safeJsonParse(rostersResp.text)
    const standings = safeJsonParse(standingsResp.text)

    return jsonResponse({
      leagueInfo,
      rosters,
      standings,
      meta: {
        leagueInfoOk: leagueInfoResp.ok,
        rostersOk: rostersResp.ok,
        standingsOk: standingsResp.ok,
      },
      rawErrors: {
        leagueInfo:
          leagueInfoResp.ok || leagueInfo
            ? ""
            : leagueInfoResp.text.slice(0, 300),
        rosters:
          rostersResp.ok || rosters
            ? ""
            : rostersResp.text.slice(0, 300),
        standings:
          standingsResp.ok || standings
            ? ""
            : standingsResp.text.slice(0, 300),
      },
    })
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    )
  }
}