import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useSeason } from "../context/SeasonContext"
import { extractTeamsFromLeagueInfo } from "../utils/fantrax"

export default function TeamsPage() {
  const { season } = useSeason()
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

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
  }, [season.key])

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
      <div style={card}>
        <div style={eyebrow}>Teams</div>
        <h2 style={{ margin: 0 }}>{season.label} teams</h2>
      </div>

      {loading ? (
        <div style={{ padding: 16 }}>Loading teams...</div>
      ) : error ? (
        <div style={errorBox}>{error}</div>
      ) : (
        <div style={grid}>
          {teams.map((team) => (
            <Link
              key={team.id}
              to={`/teams/${team.id}`}
              style={teamCard}
            >
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>
                {team.name}
              </div>
              <div style={{ color: "#6b7280", marginTop: 6 }}>
                {team.shortName || "—"}
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
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
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