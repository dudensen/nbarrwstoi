import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useSeason } from "../context/SeasonContext"
import { extractTeamsFromLeagueInfo } from "../utils/fantrax"
import { canonicalTeamName, slugifyTeamName } from "../utils/history"

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const historical = useMemo(() => isHistoricalSeason(season), [season])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        if (historical) {
          const res = await fetch("/data/history-data.json")
          const text = await res.text()

          if (!res.ok) {
            throw new Error(`History data failed (${res.status}): ${text}`)
          }

          const json = JSON.parse(text)
          const historicalTeams = buildHistoricalTeams(json?.rows || [], season.key)

          if (!cancelled) {
            setTeams(historicalTeams)
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
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setTeams([])
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

  const subtitle = historical
    ? "Historical teams from the pre-Fantrax database"
    : "Live teams from the selected Fantrax season"

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
      <div style={card}>
        <div style={eyebrow}>Teams</div>
        <h2 style={{ margin: 0 }}>{season.label} teams</h2>
        <div style={{ color: "#6b7280", marginTop: 8 }}>{subtitle}</div>
      </div>

      {loading ? (
        <div style={{ padding: 16 }}>Loading teams...</div>
      ) : error ? (
        <div style={errorBox}>{error}</div>
      ) : (
        <div style={grid}>
          {teams.map((team) => (
            <Link
              key={team.id || team.name}
              to={`/teams/${slugifyTeamName(team.name)}?season=${encodeURIComponent(season.key)}`}
              style={teamCard}
            >
              <div style={teamTopRow}>
                <TeamLogo teamName={team.name} />

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>
                    {team.name}
                  </div>

                  <div style={{ color: "#6b7280", marginTop: 6 }}>
                    {team.shortName || "—"}
                  </div>
                </div>
              </div>

              <div style={{ color: "#f97316", marginTop: 14, fontWeight: 600 }}>
                View team profile →
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}

const card = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 24,
  marginBottom: 20,
}

const eyebrow = {
  color: "#f97316",
  fontWeight: 700,
  marginBottom: 8,
}

const errorBox = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 24,
  color: "#9a3412",
}

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 16,
}

const teamCard = {
  display: "block",
  textDecoration: "none",
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 20,
}

const teamTopRow = {
  display: "flex",
  alignItems: "center",
  gap: 14,
}