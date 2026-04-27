interface PagesContext {
  request: Request
}

const FBO_MOVIES_URL = "https://www.fantasyboxofficegame.com/api/movies-by-ids"

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=900",
    },
  })
}

export const onRequestGet = async ({
  request,
}: PagesContext): Promise<Response> => {
  try {
    const url = new URL(request.url)
    const idsParam = url.searchParams.get("ids") || ""

    const ids = idsParam
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .filter((id) => /^tt\d+$/i.test(id))

    if (!ids.length) {
      return jsonResponse({ movies: {} })
    }

    const fboUrl = `${FBO_MOVIES_URL}?ids=${encodeURIComponent(
      ids.join(",")
    )}&view=league&v=league-scoped-v1`

    const resp = await fetch(fboUrl, {
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        referer: "https://www.fantasyboxofficegame.com/",
      },
    })

    const text = await resp.text()

    if (!resp.ok) {
      return jsonResponse(
        {
          error: `Fantasy Box Office movies request failed (${resp.status})`,
          preview: text.slice(0, 300),
          movies: {},
        },
        resp.status
      )
    }

    let raw: any = {}

    try {
      raw = JSON.parse(text)
    } catch {
      return jsonResponse(
        {
          error: "Fantasy Box Office movies endpoint did not return JSON.",
          preview: text.slice(0, 300),
          movies: {},
        },
        502
      )
    }

    const moviesSource =
      raw?.movies && typeof raw.movies === "object" ? raw.movies : raw

    const movies = Object.fromEntries(
      Object.entries(moviesSource || {}).map(([imdbId, movieLike]: any) => {
        const movie = movieLike || {}

        const budget =
  movie.budget == null || movie.budget === ""
    ? null
    : Number(movie.budget)

const worldwideGross =
  movie.worldwide_gross ??
  movie.worldwideGross ??
  movie.grossToDate ??
  null

const grossNumber =
  worldwideGross == null || worldwideGross === ""
    ? null
    : Number(worldwideGross)

const score =
  grossNumber !== null &&
  budget !== null &&
  Number.isFinite(grossNumber) &&
  Number.isFinite(budget)
    ? grossNumber - budget * 2.5
    : null

return [
  imdbId,
  {
    imdbId: movie.imdb_id || movie.imdbId || movie.id || imdbId,
    title:
      movie.movie_title ||
      movie.title ||
      movie.name ||
      movie.original_title ||
      "",
    releaseDate:
      movie.releaseDate ||
      movie.release_date ||
      movie.release_date_iso ||
      "",
    status:
      movie.status ||
      movie.release_status ||
      "",
    budget: Number.isFinite(budget) ? budget : null,
    estimatedBudget:
      typeof movie.estimated_budget === "boolean"
        ? movie.estimated_budget
        : typeof movie.estimatedBudget === "boolean"
          ? movie.estimatedBudget
          : null,
    worldwideGross: Number.isFinite(grossNumber) ? grossNumber : null,
    score,
  },
]
      })
    )

    return jsonResponse({ movies })
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        movies: {},
      },
      500
    )
  }
}