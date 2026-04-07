import { useEffect, useMemo, useRef, useState } from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import SeasonSelector from "./SeasonSelector"
import { HISTORICAL_DRAFT_RESULTS } from "../config/historicalDraftResults"

const LINKS = [
  ["/", "Home"],
  ["/standings", "Standings"],
  ["/teams", "Teams"],
  ["/league-rules", "League Rules"],
  ["/draft-results", "Draft Results"],
  ["/history", "History"],
  ["/contracts", "Contracts"],
  ["/war-room", "The War Room"],
]

const playerCsvFiles = import.meta.glob("../config/playerCsv/*.csv", {
  query: "?raw",
  import: "default",
})

function decodeMaybeBrokenText(value) {
  if (typeof value !== "string") return value ?? ""
  try {
    return decodeURIComponent(escape(value))
  } catch {
    return value
  }
}

function parsePlayerCsv(text = "") {
  const rows = []
  let current = []
  let value = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        value += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === "," && !inQuotes) {
      current.push(value)
      value = ""
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") i++
      current.push(value)
      rows.push(current)
      current = []
      value = ""
    } else {
      value += char
    }
  }

  if (value.length || current.length) {
    current.push(value)
    rows.push(current)
  }

  if (!rows.length) return []

  const headers = rows[0].map((h) => String(h || "").trim())

  return rows.slice(1).map((row) => {
    const obj = {}
    headers.forEach((header, idx) => {
      obj[header] = row[idx] ?? ""
    })
    return obj
  })
}

function slugifyPlayerName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function getPlayerNameFromRow(row) {
  const raw =
    row?.name ||
    row?.playerName ||
    row?.fullName ||
    row?.Player ||
    row?.player?.name ||
    [row?.firstName, row?.lastName].filter(Boolean).join(" ") ||
    [row?.first_name, row?.last_name].filter(Boolean).join(" ") ||
    ""

  return decodeMaybeBrokenText(raw).trim()
}

function getPlayerPosFromRow(row) {
  return String(
    row?.pos ||
      row?.position ||
      row?.Position ||
      row?.posShortName ||
      row?.player?.pos ||
      ""
  ).trim()
}

function getAdpNumber(row) {
  if (typeof row?.ADP === "number") return row.ADP
  if (Number.isFinite(Number(row?.ADP))) return Number(row.ADP)
  if (typeof row?.adp === "number") return row.adp
  if (Number.isFinite(Number(row?.adp))) return Number(row.adp)
  return null
}

function addPlayerToMap(map, player) {
  if (!player?.name) return

  const slug = slugifyPlayerName(player.name)
  if (!slug) return

  const existing = map.get(slug)

  if (!existing) {
    map.set(slug, {
      name: player.name,
      slug,
      pos: player.pos || "",
      adp: player.adp ?? null,
      seasons: Array.isArray(player.seasons) ? [...player.seasons] : [],
      source: player.source || "",
    })
    return
  }

  const mergedSeasons = new Set([...(existing.seasons || []), ...(player.seasons || [])])

  map.set(slug, {
    ...existing,
    ...player,
    slug,
    name: existing.name || player.name,
    pos: existing.pos || player.pos || "",
    adp: existing.adp ?? player.adp ?? null,
    seasons: Array.from(mergedSeasons).sort(),
    source: existing.source || player.source || "",
  })
}

function buildHistoricalDraftPlayers() {
  const map = new Map()

  Object.entries(HISTORICAL_DRAFT_RESULTS || {}).forEach(([seasonKey, rows]) => {
    ;(rows || []).forEach((row) => {
      const name = String(row?.player || "").trim()
      if (!name) return

      addPlayerToMap(map, {
        name,
        pos: "",
        adp: null,
        seasons: [seasonKey],
        source: "history-draft",
      })
    })
  })

  return map
}

function buildHistoricalCsvPlayers(csvEntries = []) {
  const map = new Map()

  csvEntries.forEach(({ seasonKey, rows }) => {
    ;(rows || []).forEach((row) => {
      const name = decodeMaybeBrokenText(row?.Player || "").trim()
      if (!name) return

      addPlayerToMap(map, {
        name,
        pos: String(row?.Position || "").trim(),
        adp: null,
        seasons: seasonKey ? [seasonKey] : [],
        source: "history-csv",
      })
    })
  })

  return map
}

function buildSearchPlayers(adpRows = [], csvEntries = []) {
  const bySlug = new Map()

  for (const row of adpRows) {
    const name = getPlayerNameFromRow(row)
    if (!name) continue

    addPlayerToMap(bySlug, {
      name,
      pos: getPlayerPosFromRow(row),
      adp: getAdpNumber(row),
      seasons: [],
      source: "adp",
    })
  }

  for (const player of buildHistoricalDraftPlayers().values()) {
    addPlayerToMap(bySlug, player)
  }

  for (const player of buildHistoricalCsvPlayers(csvEntries).values()) {
    addPlayerToMap(bySlug, player)
  }

  return Array.from(bySlug.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
      numeric: true,
    })
  )
}

function filterPlayers(players, query) {
  const clean = normalizeSearchText(query)
  if (!clean) return []

  const terms = clean.split(" ").filter(Boolean)

  return players
    .map((player) => {
      const normalizedName = normalizeSearchText(player.name)
      if (!normalizedName) return null
      if (!terms.every((term) => normalizedName.includes(term))) return null

      let score = 0

      if (normalizedName === clean) score += 1000
      if (normalizedName.startsWith(clean)) score += 700
      if (normalizedName.includes(clean)) score += 350

      for (const term of terms) {
        if (normalizedName.startsWith(term)) score += 60
        else if (normalizedName.includes(` ${term}`)) score += 35
        else if (normalizedName.includes(term)) score += 15
      }

      if (typeof player.adp === "number") {
        score += Math.max(0, 120 - player.adp)
      }

      return { ...player, score }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score

      const aHasAdp = typeof a.adp === "number"
      const bHasAdp = typeof b.adp === "number"

      if (aHasAdp && bHasAdp && a.adp !== b.adp) return a.adp - b.adp
      if (aHasAdp !== bHasAdp) return aHasAdp ? -1 : 1

      return a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      })
    })
    .slice(0, 8)
}

export default function Header() {
  const navigate = useNavigate()
  const location = useLocation()

  const [query, setQuery] = useState("")
  const [players, setPlayers] = useState([])
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [playersError, setPlayersError] = useState("")
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const containerRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function loadPlayers() {
      try {
        setLoadingPlayers(true)
        setPlayersError("")

        const csvLoaders = Object.entries(playerCsvFiles).map(async ([path, loader]) => {
          const text = await loader()
          const seasonKey =
            path.match(/\/([^/]+)\.csv$/)?.[1] ||
            ""

          return {
            seasonKey,
            rows: parsePlayerCsv(text),
          }
        })

        const [csvEntries, adpResult] = await Promise.all([
          Promise.all(csvLoaders),
          fetch("/api/adp")
            .then(async (res) => {
              const text = await res.text()
              if (!res.ok) {
                throw new Error(`ADP failed (${res.status}): ${text}`)
              }
              return JSON.parse(text)
            })
            .catch(() => []),
        ])

        const mergedPlayers = buildSearchPlayers(
          Array.isArray(adpResult) ? adpResult : [],
          csvEntries
        )

        if (!cancelled) {
          setPlayers(mergedPlayers)
        }
      } catch (err) {
        if (!cancelled) {
          setPlayersError(err instanceof Error ? err.message : "Could not load player search")
          setPlayers([])
        }
      } finally {
        if (!cancelled) setLoadingPlayers(false)
      }
    }

    loadPlayers()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setOpen(false)
    setHighlightedIndex(-1)
    setQuery("")
  }, [location.pathname])

  useEffect(() => {
    function handleClickOutside(event) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target)) {
        setOpen(false)
        setHighlightedIndex(-1)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  const suggestions = useMemo(() => filterPlayers(players, query), [players, query])

  useEffect(() => {
    setHighlightedIndex(suggestions.length ? 0 : -1)
  }, [query, suggestions.length])

  function goToPlayer(player) {
    if (!player?.slug) return
    setOpen(false)
    setHighlightedIndex(-1)
    setQuery("")
    navigate(`/players/${player.slug}`)
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (!query.trim()) return

    const selected =
      highlightedIndex >= 0 && highlightedIndex < suggestions.length
        ? suggestions[highlightedIndex]
        : suggestions[0]

    if (selected) goToPlayer(selected)
  }

  function handleKeyDown(event) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setOpen(true)
      return
    }

    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (!suggestions.length) return
      setHighlightedIndex((prev) => (prev >= suggestions.length - 1 ? 0 : prev + 1))
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      if (!suggestions.length) return
      setHighlightedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1))
      return
    }

    if (event.key === "Escape") {
      setOpen(false)
      setHighlightedIndex(-1)
    }
  }

  const showSuggestions = open && query.trim().length > 0

  return (
    <header
      style={{
        background: "linear-gradient(135deg, #ea580c 0%, #f97316 55%, #fb923c 100%)",
        color: "#ffffff",
        padding: "14px 0 12px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "0 20px",
          display: "grid",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <img
            src="/fx-logo.webp"
            alt="NBArrwstoi Fantasy League logo"
            style={{
              width: 76,
              height: 76,
              objectFit: "contain",
              borderRadius: 16,
              background: "rgba(255,255,255,0.16)",
              padding: 6,
              boxSizing: "border-box",
              flexShrink: 0,
              boxShadow: "0 8px 22px rgba(0,0,0,0.14)",
            }}
          />

          <div
            style={{
              flex: "1 1 760px",
              minWidth: 280,
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 220 }}>
                <h1
                  style={{
                    margin: 0,
                    fontSize: "clamp(16px, 2vw, 22px)",
                    lineHeight: 1.05,
                    fontWeight: 800,
                  }}
                >
                  NBArrwstoi Fantasy League
                </h1>

                <p
                  style={{
                    margin: "4px 0 0",
                    opacity: 0.96,
                    fontSize: 13,
                    maxWidth: 760,
                  }}
                >
                  Live Fantrax data, historical records, team pages, draft history, and player profiles.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                <div ref={containerRef} style={{ position: "relative", width: 260, maxWidth: "100%" }}>
                  <form onSubmit={handleSubmit}>
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value)
                        setOpen(true)
                      }}
                      onFocus={() => setOpen(true)}
                      onKeyDown={handleKeyDown}
                      placeholder="Search player..."
                      autoComplete="off"
                      style={{
                        width: "100%",
                        height: 38,
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.28)",
                        background: "rgba(255,255,255,0.14)",
                        color: "#ffffff",
                        padding: "0 14px",
                        outline: "none",
                        fontSize: 13,
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
                      }}
                    />
                  </form>

                  {showSuggestions ? (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        left: 0,
                        right: 0,
                        background: "#ffffff",
                        color: "#111827",
                        borderRadius: 16,
                        border: "1px solid #fed7aa",
                        boxShadow: "0 18px 40px rgba(17,24,39,0.18)",
                        overflow: "hidden",
                        zIndex: 60,
                      }}
                    >
                      {loadingPlayers && !players.length ? (
                        <div style={{ padding: 12, color: "#6b7280", fontSize: 13 }}>
                          Loading players...
                        </div>
                      ) : suggestions.length ? (
                        suggestions.map((player, index) => {
                          const active = index === highlightedIndex

                          return (
                            <button
                              key={player.slug}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => goToPlayer(player)}
                              onMouseEnter={() => setHighlightedIndex(index)}
                              style={{
                                width: "100%",
                                border: 0,
                                textAlign: "left",
                                background: active ? "#fff7ed" : "#ffffff",
                                padding: "10px 12px",
                                cursor: "pointer",
                                borderBottom:
                                  index === suggestions.length - 1 ? "none" : "1px solid #ffedd5",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 12,
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontWeight: 700,
                                    color: "#111827",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    fontSize: 14,
                                  }}
                                >
                                  {player.name}
                                </div>
                                <div
                                  style={{
                                    marginTop: 2,
                                    fontSize: 12,
                                    color: "#6b7280",
                                  }}
                                >
                                  {player.pos || "—"}
                                  {typeof player.adp === "number"
                                    ? ` · ADP ${player.adp.toFixed(2)}`
                                    : player.seasons?.length
                                    ? ` · ${player.seasons[0]}${player.seasons.length > 1 ? "…" : ""}`
                                    : ""}
                                </div>
                              </div>

                              <div
                                style={{
                                  color: "#f97316",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                Open
                              </div>
                            </button>
                          )
                        })
                      ) : (
                        <div style={{ padding: 12, color: "#6b7280", fontSize: 13 }}>
                          No players found.
                        </div>
                      )}

                      {playersError ? (
                        <div
                          style={{
                            padding: "10px 12px",
                            fontSize: 12,
                            color: "#9a3412",
                            background: "#fff7ed",
                            borderTop: "1px solid #ffedd5",
                          }}
                        >
                          Search index could not fully load.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <SeasonSelector />
              </div>
            </div>

            <nav
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              {LINKS.map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  style={({ isActive }) => ({
                    textDecoration: "none",
                    color: isActive ? "#f97316" : "#ffffff",
                    background: isActive ? "#ffffff" : "rgba(255,255,255,0.14)",
                    padding: "9px 14px",
                    borderRadius: 999,
                    fontWeight: 600,
                    fontSize: 13,
                    border: isActive
                      ? "1px solid #ffffff"
                      : "1px solid rgba(255,255,255,0.10)",
                    transition: "all 0.15s ease",
                  })}
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </header>
  )
}