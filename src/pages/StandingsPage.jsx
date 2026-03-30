import { useEffect, useState } from "react"
import StandingsTable from "../components/StandingsTable"
import { useSeason } from "../context/SeasonContext"

export default function StandingsPage() {
  const { season } = useSeason()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        const res = await fetch(`/api/standings?season=${encodeURIComponent(season.key)}`)
        const text = await res.text()

        if (!res.ok) {
          throw new Error(`Request failed (${res.status}): ${text}`)
        }

        const json = JSON.parse(text)

        if (!cancelled) {
          setRows(Array.isArray(json) ? json : [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setRows([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [season.key])

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #fed7aa",
          borderRadius: 20,
          padding: 24,
          marginBottom: 20,
        }}
      >
        <div style={{ color: "#f97316", fontWeight: 700, marginBottom: 8 }}>
          Standings
        </div>
        <h2 style={{ margin: 0 }}>{season.label} standings</h2>
        <p style={{ color: "#6b7280", marginTop: 10 }}>
          This page reads the selected season and hits the matching Fantrax league automatically.
        </p>
      </div>

      {loading ? (
        <div style={{ padding: 16 }}>Loading standings...</div>
      ) : error ? (
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 20,
            padding: 24,
            color: "#9a3412",
          }}
        >
          {error}
        </div>
      ) : (
        <StandingsTable rows={rows} />
      )}
    </main>
  )
}