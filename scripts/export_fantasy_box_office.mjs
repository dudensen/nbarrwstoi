import fs from "node:fs/promises"
import path from "node:path"
import { SIDELEAGUES } from "../src/config/sideleagues.js"

const MOVIES_BY_IDS_BASE_URL =
  "https://www.fantasyboxofficegame.com/api/movies-by-ids"

const LEAGUES = SIDELEAGUES
  .filter((league) => league?.view === "fantasy_box_office")
  .filter((league) => league?.fboLeagueId)
  .map((league) => ({
    key: league.key,
    leagueId: league.fboLeagueId,
    year: String(league.seasonLabel || league.year || "2026"),
    dataUrl: league.dataUrl,
    displayName: league.name || league.key,
  }))

function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return value

  if ("stringValue" in value) return value.stringValue
  if ("integerValue" in value) return Number(value.integerValue)
  if ("doubleValue" in value) return Number(value.doubleValue)
  if ("booleanValue" in value) return Boolean(value.booleanValue)
  if ("timestampValue" in value) return value.timestampValue
  if ("nullValue" in value) return null

  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(fromFirestoreValue)
  }

  if ("mapValue" in value) {
    const fields = value.mapValue.fields || {}
    return Object.fromEntries(
      Object.entries(fields).map(([key, child]) => [key, fromFirestoreValue(child)])
    )
  }

  return value
}

function fromFirestoreDocument(doc) {
  const fields = doc?.fields || {}
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)])
  )
}

function cleanText(value) {
  return String(value ?? "").trim()
}

function moneyNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function getOutputFile(config) {
  const fileName =
    String(config.dataUrl || "")
      .replace(/^\/+/, "")
      .replace(/^data\/sideleagues\//, "") || `${config.key}.json`

  return path.join(
    process.cwd(),
    "public",
    "data",
    "sideleagues",
    fileName
  )
}

function getMoviesCacheFile(config) {
  return path.join(
    process.cwd(),
    "public",
    "data",
    "sideleagues",
    `${config.key}-movies.json`
  )
}

function buildStudios(league) {
  const studiosMap = league?.studios || {}

  return Object.entries(studiosMap).map(([userId, studio]) => ({
    userId,
    studioName: cleanText(studio?.studioName),
    playerName: cleanText(studio?.playerName),
    color: cleanText(studio?.playerColor),
    description: cleanText(studio?.studioDescription),
  }))
}

function buildStudioLookup(studios) {
  const map = new Map()

  for (const studio of studios) {
    map.set(studio.userId, studio)
  }

  return map
}

function normalizePick(rawPick, studioLookup) {
  const movie = rawPick?.movie || {}
  const userId = cleanText(rawPick?.userId)
  const studio = studioLookup.get(userId)
  const imdbId = cleanText(movie?.imdb_id || movie?.imdbId)

  return {
    userId,
    studioName: studio?.studioName || userId || "—",
    playerName: studio?.playerName || "",
    color: studio?.color || "",
    stage: cleanText(movie?.stage),
    seasonType: cleanText(movie?.seasonType),
    pickOrder: movie?.pickOrder ?? "",
    imdbId,
    title: "",
    releaseDate: "",
    status: "",
    budget: null,
    estimatedBudget: null,
    worldwideGross: null,
    domesticGross: null,
    grossToDate: null,
    score: null,
    posterPath: "",
    movieSlug: "",
    isLastAvailableMovie: Boolean(rawPick?.isLastAvailableMovie),
  }
}

function getDraftPicksForSeason(league, seasonKey, studioLookup, year) {
  const season = league?.years?.[year]?.seasons?.[seasonKey] || null
  const rows = Array.isArray(season?.draftPicks) ? season.draftPicks : []

  return rows
    .map((pick) => normalizePick(pick, studioLookup))
    .filter((pick) => pick.imdbId)
    .sort((a, b) => Number(a.pickOrder || 9999) - Number(b.pickOrder || 9999))
}

function uniqueImdbIdsFromDrafts(drafts) {
  return Array.from(
    new Set(
      Object.values(drafts)
        .flat()
        .map((pick) => pick.imdbId)
        .filter(Boolean)
    )
  ).sort()
}

async function readMoviesCache(config) {
  const moviesCacheFile = getMoviesCacheFile(config)

  try {
    const text = await fs.readFile(moviesCacheFile, "utf8")
    const json = JSON.parse(text)

    console.log(`Loaded movie cache: ${moviesCacheFile}`)
    return json && typeof json === "object" ? json : {}
  } catch {
    console.warn(`Movie cache not found or invalid: ${moviesCacheFile}`)
    return {}
  }
}

async function fetchMoviesByIds(imdbIds, config) {
  const cached = await readMoviesCache(config)

  const cachedCount = Object.keys(cached).length
  if (cachedCount > 0) {
    console.log(`Using cached movie metadata (${cachedCount} movies).`)
    return cached
  }

  if (!imdbIds.length) return {}

  const url = `${MOVIES_BY_IDS_BASE_URL}?ids=${encodeURIComponent(
    imdbIds.join(",")
  )}&view=league&v=league-scoped-v1`

  console.log(`Fetching ${imdbIds.length} movies...`)

  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
    },
  })

  const text = await res.text()

  if (!res.ok) {
    console.warn(
      `Fantasy Box Office movies request failed (${res.status}). Continuing without movie titles.`
    )
    console.warn(text.slice(0, 300))
    return {}
  }

  try {
    const json = JSON.parse(text)
    const moviesCacheFile = getMoviesCacheFile(config)

    await fs.mkdir(path.dirname(moviesCacheFile), { recursive: true })
    await fs.writeFile(moviesCacheFile, `${JSON.stringify(json, null, 2)}\n`, "utf8")
    console.log(`Saved movie cache: ${moviesCacheFile}`)

    return json
  } catch {
    console.warn("Movies endpoint did not return JSON. Continuing without movie titles.")
    return {}
  }
}

function calculateMovieScore(worldwideGross, budget) {
  const gross = moneyNumber(worldwideGross)
  const cost = moneyNumber(budget)

  if (gross == null || gross <= 0) return null
  if (cost == null) return null

  return gross - cost * 2.5
}

function enrichPickWithMovie(pick, moviesById) {
  const movie = moviesById?.[pick.imdbId] || null

  if (!movie) return pick

  const budget = moneyNumber(movie.budget)

  const worldwideGross =
    moneyNumber(movie.worldwide_gross) ??
    moneyNumber(movie.worldwideGross) ??
    moneyNumber(movie.grossToDate) ??
    null

  return {
    ...pick,
    title: cleanText(
      movie.movie_title ||
        movie.title ||
        movie.name ||
        movie.original_title ||
        pick.title
    ),
    releaseDate: cleanText(
      movie.releaseDate ||
        movie.release_date ||
        movie.release_date_iso ||
        pick.releaseDate
    ),
    status: cleanText(
      movie.status ||
        movie.release_status ||
        pick.status
    ),
    budget,
    estimatedBudget:
      typeof movie.estimated_budget === "boolean"
        ? movie.estimated_budget
        : typeof movie.estimatedBudget === "boolean"
          ? movie.estimatedBudget
          : null,
    worldwideGross,
    domesticGross: moneyNumber(movie.domestic_gross),
    grossToDate: moneyNumber(movie.grossToDate),
    score: calculateMovieScore(worldwideGross, budget),
    posterPath: cleanText(movie.poster_path),
    movieSlug: cleanText(movie.movie_slug),
  }
}

function enrichDraftsWithMovies(drafts, moviesById) {
  return Object.fromEntries(
    Object.entries(drafts).map(([key, picks]) => [
      key,
      picks.map((pick) => enrichPickWithMovie(pick, moviesById)),
    ])
  )
}

async function exportLeague(config) {
  const leagueId = config.leagueId
  const year = config.year
  const outputFile = getOutputFile(config)

  const firestoreUrl =
    `https://firestore.googleapis.com/v1/projects/fantasy-box-office/databases/(default)/documents/leagues/${leagueId}`

  console.log(`Fetching Fantasy Box Office league ${config.key} (${leagueId})...`)

  const res = await fetch(firestoreUrl, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
    },
  })

  const text = await res.text()

  if (!res.ok) {
    throw new Error(
      `Fantasy Box Office Firestore request failed for ${config.key} (${res.status}): ${text.slice(0, 500)}`
    )
  }

  const doc = JSON.parse(text)
  const league = fromFirestoreDocument(doc)

  const studios = buildStudios(league)
  const studioLookup = buildStudioLookup(studios)

  const rawDrafts = {
    WINTER: getDraftPicksForSeason(league, "WINTER", studioLookup, year),
    SUMMER: getDraftPicksForSeason(league, "SUMMER", studioLookup, year),
    HITS: getDraftPicksForSeason(league, "HITS", studioLookup, year),
    BOMBS: getDraftPicksForSeason(league, "BOMBS", studioLookup, year),
    FALL: getDraftPicksForSeason(league, "FALL", studioLookup, year),
  }

  const imdbIds = uniqueImdbIdsFromDrafts(rawDrafts)
  const moviesById = await fetchMoviesByIds(imdbIds, config)
  const drafts = enrichDraftsWithMovies(rawDrafts, moviesById)

  const output = {
    key: config.key,
    leagueId,
    leagueName: league?.name || config.displayName || config.key,
    nameNormalized: league?.nameNormalized || "",
    year: Number(league?.year || year),
    updatedAt: doc?.updateTime || league?.updatedAt || "",
    lastStatusUpdate: league?.lastStatusUpdate || "",
    source: "Fantasy Box Office / Firestore + movies-by-ids",
    studios,
    drafts,
  }

  await fs.mkdir(path.dirname(outputFile), { recursive: true })
  await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8")

  console.log(`Saved ${outputFile}`)
  console.log(`League name: ${output.leagueName}`)
  console.log(`Studios: ${output.studios.length}`)
  console.log(`Winter picks: ${output.drafts.WINTER.length}`)
  console.log(`Summer picks: ${output.drafts.SUMMER.length}`)
  console.log(`Hit picks: ${output.drafts.HITS.length}`)
  console.log(`Bomb picks: ${output.drafts.BOMBS.length}`)
  console.log(`Fall picks: ${output.drafts.FALL.length}`)
  console.log("")
}

async function main() {
  if (!LEAGUES.length) {
    console.log("No Fantasy Box Office sideleagues found in sideleagues.js")
    return
  }

  console.log(`Found ${LEAGUES.length} Fantasy Box Office sideleague(s).`)
  console.log("")

  for (const config of LEAGUES) {
    await exportLeague(config)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})