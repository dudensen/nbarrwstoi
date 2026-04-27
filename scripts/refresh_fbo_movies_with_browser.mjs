import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { SIDELEAGUES } from "../src/config/sideleagues.js"

const MOVIES_BY_IDS_BASE_URL =
  "https://www.fantasyboxofficegame.com/api/movies-by-ids"

const USER_DATA_DIR = path.join(
  process.cwd(),
  ".playwright",
  "fbo-browser-profile"
)

const FBO_LEAGUES = SIDELEAGUES
  .filter((league) => league?.view === "fantasy_box_office")
  .filter((league) => league?.fboLeagueId)
  .filter((league) => league?.dataUrl)

function getPublicJsonPathFromDataUrl(dataUrl) {
  const clean = String(dataUrl || "").replace(/^\/+/, "")

  return path.join(
    process.cwd(),
    "public",
    clean
  )
}

function getMoviesCacheFile(league) {
  return path.join(
    process.cwd(),
    "public",
    "data",
    "sideleagues",
    `${league.key}-movies.json`
  )
}

function collectImdbIds(payload) {
  const drafts = payload?.drafts || {}

  return Array.from(
    new Set(
      Object.values(drafts)
        .flat()
        .map((pick) => pick?.imdbId || pick?.imdb_id)
        .filter(Boolean)
    )
  ).sort()
}

function buildMoviesUrl(imdbIds) {
  return `${MOVIES_BY_IDS_BASE_URL}?ids=${encodeURIComponent(
    imdbIds.join(",")
  )}&view=league&v=league-scoped-v1`
}

function tryParseJsonFromText(text) {
  const clean = String(text || "").trim()

  if (!clean) {
    throw new Error("Empty response")
  }

  if (clean.startsWith("<!DOCTYPE") || clean.startsWith("<html")) {
    throw new Error("Received HTML instead of JSON. Vercel checkpoint probably appeared.")
  }

  return JSON.parse(clean)
}

async function readLeagueExport(league) {
  const filePath = getPublicJsonPathFromDataUrl(league.dataUrl)

  const text = await fs.readFile(filePath, "utf8")
  return JSON.parse(text)
}

async function fetchJsonWithBrowser(page, url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  })

  const bodyText = await page.locator("body").innerText({
    timeout: 120000,
  })

  return tryParseJsonFromText(bodyText)
}

async function refreshLeague(page, league) {
  console.log(`Refreshing movie metadata for ${league.key}...`)

  const exportedLeague = await readLeagueExport(league)
  const imdbIds = collectImdbIds(exportedLeague)

  if (!imdbIds.length) {
    console.log(`No IMDb IDs found for ${league.key}. Skipping.`)
    console.log("")
    return
  }

  const url = buildMoviesUrl(imdbIds)
  const cacheFile = getMoviesCacheFile(league)

  console.log(`Movies: ${imdbIds.length}`)
  console.log(`URL: ${url}`)

  let json

  try {
    json = await fetchJsonWithBrowser(page, url)
  } catch (err) {
    console.log("")
    console.log("Could not read clean JSON automatically.")
    console.log("If a Vercel/security page opened in the browser, complete it there.")
    console.log("Then press ENTER here to retry.")
    console.log("")

    await new Promise((resolve) => {
      process.stdin.resume()
      process.stdin.once("data", () => resolve())
    })

    json = await fetchJsonWithBrowser(page, url)
  }

  await fs.mkdir(path.dirname(cacheFile), { recursive: true })
  await fs.writeFile(cacheFile, `${JSON.stringify(json, null, 2)}\n`, "utf8")

  console.log(`Saved ${cacheFile}`)
  console.log("")
}

async function main() {
  if (!FBO_LEAGUES.length) {
    console.log("No Fantasy Box Office sideleagues found in sideleagues.js")
    return
  }

  console.log(`Found ${FBO_LEAGUES.length} Fantasy Box Office sideleague(s).`)
  console.log("")

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: {
      width: 1400,
      height: 900,
    },
  })

  const page = context.pages()[0] || await context.newPage()

  try {
    for (const league of FBO_LEAGUES) {
      await refreshLeague(page, league)
    }
  } finally {
    await context.close()
  }

  console.log("Movie cache refresh complete.")
  console.log("")
  console.log("Now run:")
  console.log("node scripts/export_fantasy_box_office.mjs")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})