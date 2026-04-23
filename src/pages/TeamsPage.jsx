import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useSeason } from "../context/SeasonContext"
import { extractTeamsFromLeagueInfo } from "../utils/fantrax"
import { buildRecords, canonicalTeamName, slugifyTeamName } from "../utils/history"

function s(value) {
  return String(value ?? "").trim()
}

function getSeasonEndYear(seasonKey) {
  const match = String(seasonKey || "").match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  return Number(`${match[1].slice(0, 2)}${match[2]}`)
}

function isHistoricalSeason(season) {
  return !season?.leagueId
}

function buildHistoricalTeams(rows = [], seasonKey = "") {
  const seasonEndYear = getSeasonEndYear(seasonKey)
  if (!seasonEndYear) return []

  const filtered = rows.filter(
    (row) => Number(row?.year) === seasonEndYear && s(row?.team)
  )

  const byTeam = new Map()

  for (const row of filtered) {
    const canonical = canonicalTeamName(row.team)
    if (!canonical) continue

    if (!byTeam.has(canonical)) {
      byTeam.set(canonical, {
        id: canonical,
        name: canonical,
        shortName: "",
        managerCounts: new Map(),
      })
    }

    const entry = byTeam.get(canonical)
    const manager = s(row?.manager)
    if (manager) {
      entry.managerCounts.set(manager, (entry.managerCounts.get(manager) || 0) + 1)
    }
  }

  return Array.from(byTeam.values())
    .map((entry) => {
      let manager = ""
      let bestCount = -1

      for (const [name, count] of entry.managerCounts.entries()) {
        if (count > bestCount) {
          manager = name
          bestCount = count
        }
      }

      return {
        id: entry.id,
        name: entry.name,
        shortName: manager || "Historical team",
      }
    })
    .sort((a, b) =>
      String(a.name).localeCompare(String(b.name), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    )
}

const RECORD_BADGES = {
  wins: { src: "/badges/badge-CATWINS.png", title: "Most Category Wins" },
  pts: { src: "/badges/badge-PTS.webp", title: "Most Points" },
  ast: { src: "/badges/badge-AST.png", title: "Most Assists" },
  stl: { src: "/badges/badge-STL.png", title: "Most Steals" },
  blk: { src: "/badges/badge-BLK.png", title: "Most Blocks" },
  fgm: { src: "/badges/badge-FGM.png", title: "Most Field Goals Made" },
  threePm: { src: "/badges/badge-3PTS.png", title: "Most 3PT Made" },
  oreb: { src: "/badges/badge-OREB.png", title: "Most Offensive Rebounds" },
  dreb: { src: "/badges/badge-DREB.png", title: "Most Defensive Rebounds" },
  fgPct: { src: "/badges/badge-FGPCT.png", title: "Best FG%" },
  threePct: { src: "/badges/badge-3PTPCT.png", title: "Best 3PT%" },
  ftPct: { src: "/badges/badge-FTPCT.png", title: "Best FT%" },
  ato: { src: "/badges/badge-ATO.png", title: "Best Assist to Turnover Ratio" },
}

function buildTeamBadgeMap(rows = []) {
  const records = buildRecords(rows)
  const byTeam = new Map()

  for (const record of records) {
    const winner = canonicalTeamName(record?.top?.team || "")
    const badge = RECORD_BADGES[record?.key]

    if (!winner || !badge) continue

    if (!byTeam.has(winner)) byTeam.set(winner, [])

    byTeam.get(winner).push({
      key: record.key,
      label: record.label,
      src: badge.src,
      title: badge.title || record.label,
    })
  }

  return byTeam
}

function TeamLogo({ teamName }) {
  const slug = slugifyTeamName(teamName)

  return (
    <img
      src={`/team-logos/${slug}.png`}
      alt={`${teamName} logo`}
      style={{
        width: 72,
        height: 72,
        objectFit: "contain",
        flexShrink: 0,
      }}
      onError={(e) => {
        e.currentTarget.style.display = "none"
      }}
    />
  )
}

export default function TeamsPage() {
  const { season } = useSeason()
  const [teams, setTeams] = useState([])
  const [teamBadgeMap, setTeamBadgeMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const historical = useMemo(() => isHistoricalSeason(season), [season])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        const historyRes = await fetch("/data/history-data.json")
        const historyText = await historyRes.text()

        if (!historyRes.ok) {
          throw new Error(`History data failed (${historyRes.status}): ${historyText}`)
        }

        const historyJson = JSON.parse(historyText)
        const historyRows = historyJson?.rows || []
        const badgeMap = buildTeamBadgeMap(historyRows)

        if (historical) {
          const historicalTeams = buildHistoricalTeams(historyRows, season.key)

          if (!cancelled) {
            setTeams(historicalTeams)
            setTeamBadgeMap(badgeMap)
          }
          return
        }

        const res = await fetch(`/api/league-info?season=${encodeURIComponent(season.key)}`)
        const text = await res.text()

        if (!res.ok) {
          throw new Error(`Request failed (${res.status}): ${text}`)
        }

        const json = JSON.parse(text)
        const extracted = extractTeamsFromLeagueInfo(json)

        if (!cancelled) {
          setTeams(extracted)
          setTeamBadgeMap(badgeMap)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setTeams([])
          setTeamBadgeMap(new Map())
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [season.key, historical])

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
      <div style={card}>
        <div style={eyebrow}>Teams</div>
        <h2 style={{ margin: 0 }}>{season.label} Active Teams</h2>
        <p style={subtitle}>
          Browse the franchises of the selected season and jump into each team page.
        </p>
      </div>

      {loading ? (
        <div style={card}>Loading teams…</div>
      ) : error ? (
        <div style={{ ...card, color: "#b91c1c" }}>{error}</div>
      ) : teams.length === 0 ? (
        <div style={card}>No teams found.</div>
      ) : (
        <div style={grid}>
          {teams.map((team) => {
            const teamName = canonicalTeamName(team.name)
            const badges = teamBadgeMap.get(teamName) || []

            return (
              <Link
                key={team.id || team.name}
                to={`/teams/${slugifyTeamName(team.name)}`}
                style={teamCard}
              >
                <div style={teamCardTop}>
                  <TeamLogo teamName={team.name} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={managerStyle}>{team.shortName || "—"}</div>
                    <div style={teamNameStyle}>{team.name}</div>

                    {badges.length > 0 ? (
                      <div style={badgeRow}>
                        {badges.map((badge) => (
                          <img
                            key={badge.key}
                            src={badge.src}
                            alt={badge.title}
                            title={badge.title}
                            style={badgeStyle}
                          />
                        ))}
                      </div>
                    ) : null}

                    
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </main>
  )
}

const card = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 24,
  padding: 24,
  boxShadow: "0 14px 34px rgba(17, 24, 39, 0.08)",
  marginBottom: 20,
}

const eyebrow = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: "#fff7ed",
  color: "#ea580c",
  border: "1px solid #fed7aa",
  padding: "8px 12px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 14,
}

const subtitle = {
  margin: "10px 0 0",
  color: "#6b7280",
  lineHeight: 1.6,
}

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 18,
}

const teamCard = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 24,
  padding: 20,
  boxShadow: "0 14px 34px rgba(17, 24, 39, 0.08)",
  display: "block",
  transition: "transform 0.15s ease, box-shadow 0.15s ease",
}

const teamCardTop = {
  display: "flex",
  alignItems: "center",
  gap: 16,
}

const teamNameStyle = {
  fontSize: 20,
  fontWeight: 800,
  color: "#111827",
  lineHeight: 1.15,
}

const managerStyle = {
  color: "#6b7280",
  marginTop: 8,
  fontSize: 14,
}

const badgeRow = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 8,
}

const badgeStyle = {
  width: 30,
  height: 30,
  objectFit: "contain",
  flexShrink: 0,
}