import { useEffect, useMemo, useState } from "react"
import { useSeason } from "../context/SeasonContext"

function formatValue(value) {
  if (value == null || value === "") return "—"
  return String(value)
}

export default function LeagueRulesPage() {
  const { season } = useSeason()
  const [leagueInfo, setLeagueInfo] = useState(null)
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
          throw new Error(`League info failed (${res.status}): ${text}`)
        }

        const json = JSON.parse(text)

        if (!cancelled) {
          setLeagueInfo(json)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setLeagueInfo(null)
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

  const data = useMemo(() => {
    const rosterInfo = leagueInfo?.rosterInfo || {}
    const poolSettings = leagueInfo?.poolSettings || {}
    const scoringSystem = leagueInfo?.scoringSystem || {}

    const slots = Object.entries(rosterInfo.positionConstraints || {})
      .map(([slot, config]) => ({
        slot,
        maxActive: config?.maxActive ?? 0,
      }))
      .sort((a, b) => a.slot.localeCompare(b.slot))

    const categories =
      scoringSystem?.scoringCategorySettings?.[0]?.configs?.map((cfg) => ({
        shortName: cfg?.scoringCategory?.shortName || "—",
        name: cfg?.scoringCategory?.name || "—",
        weight: cfg?.weight ?? "—",
      })) || []

    return {
      leagueName: leagueInfo?.leagueName || "League",
      seasonYear: leagueInfo?.seasonYear || "—",
      draftType: leagueInfo?.draftType || leagueInfo?.draftSettings?.draftType || "—",
      scoringType: scoringSystem?.type || "—",
      startDate: leagueInfo?.startDate || "—",
      endDate: leagueInfo?.endDate || "—",
      maxTotalPlayers: rosterInfo?.maxTotalPlayers ?? "—",
      maxTotalActivePlayers: rosterInfo?.maxTotalActivePlayers ?? "—",
      duplicatePlayerType: poolSettings?.duplicatePlayerType ?? "—",
      playerSourceType: poolSettings?.playerSourceType ?? "—",
      slots,
      categories,
    }
  }, [leagueInfo])

  return (
    <main style={main}>
      <section style={hero}>
        <div style={eyebrow}>League Rules</div>
        <h1 style={heroTitle}>{data.leagueName}</h1>
        <p style={heroSub}>
          {season.label} · Season year {data.seasonYear}
        </p>
      </section>

      {loading ? (
        <div style={loadingBox}>Loading league rules...</div>
      ) : error ? (
        <div style={errorBox}>{error}</div>
      ) : (
        <>
          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>League Overview</h2>
              <p style={sectionSub}>Core settings for format, pool, and dates.</p>
            </div>

            <div style={topCardsGrid}>
              <RuleCard label="Draft Type" value={data.draftType} />
              <RuleCard label="Scoring Type" value={data.scoringType} />
              <RuleCard label="Season Start" value={data.startDate} />
              <RuleCard label="Season End" value={data.endDate} />
              <RuleCard label="Total Roster Size" value={data.maxTotalPlayers} />
              <RuleCard label="Active Lineup Size" value={data.maxTotalActivePlayers} />
              <RuleCard label="Duplicate Players" value={data.duplicatePlayerType} />
              <RuleCard label="Player Source" value={data.playerSourceType} />
            </div>
          </section>

          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>Active Lineup Slots</h2>
              <p style={sectionSub}>How many active players can be placed in each slot.</p>
            </div>

            <div style={slotGrid}>
              {data.slots.map((slot) => (
                <div key={slot.slot} style={slotCard}>
                  <div style={slotName}>{slot.slot}</div>
                  <div style={slotCount}>{slot.maxActive}</div>
                  <div style={slotLabel}>max active</div>
                </div>
              ))}
            </div>
          </section>

          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>Scoring Categories</h2>
              <p style={sectionSub}>Rotisserie categories and their weights.</p>
            </div>

            <div style={catGrid}>
              {data.categories.map((cat, idx) => (
                <div key={`${cat.shortName}-${idx}`} style={catCard}>
                  <div style={catTopRow}>
                    <span style={catShort}>{cat.shortName}</span>
                    <span style={catWeight}>x{formatValue(cat.weight)}</span>
                  </div>
                  <div style={catName}>{cat.name}</div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}

function RuleCard({ label, value }) {
  return (
    <div style={ruleCard}>
      <div style={ruleLabel}>{label}</div>
      <div style={ruleValue}>{formatValue(value)}</div>
    </div>
  )
}

const main = {
  maxWidth: 1240,
  margin: "0 auto",
  padding: "32px 20px 48px",
}

const hero = {
  background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)",
  color: "#ffffff",
  borderRadius: 28,
  padding: "28px 28px 30px",
  marginBottom: 24,
  boxShadow: "0 18px 40px rgba(249,115,22,0.18)",
}

const eyebrow = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  opacity: 0.95,
  marginBottom: 10,
}

const heroTitle = {
  margin: 0,
  fontSize: "clamp(28px, 4vw, 40px)",
  lineHeight: 1.05,
}

const heroSub = {
  margin: "10px 0 0",
  fontSize: 16,
  opacity: 0.95,
}

const section = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 24,
  padding: 24,
  marginBottom: 22,
}

const sectionHeader = {
  marginBottom: 18,
}

const sectionTitle = {
  margin: 0,
  fontSize: 24,
  color: "#111827",
}

const sectionSub = {
  margin: "8px 0 0",
  color: "#6b7280",
  fontSize: 15,
}

const topCardsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
}

const ruleCard = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 18,
  minHeight: 92,
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
}

const ruleLabel = {
  fontSize: 13,
  fontWeight: 700,
  color: "#9a3412",
  letterSpacing: "0.02em",
}

const ruleValue = {
  marginTop: 10,
  fontSize: 22,
  fontWeight: 800,
  color: "#111827",
  lineHeight: 1.1,
  wordBreak: "break-word",
}

const slotGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  gap: 14,
}

const slotCard = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 18,
  textAlign: "center",
  boxShadow: "0 8px 20px rgba(15,23,42,0.04)",
}

const slotName = {
  fontSize: 15,
  fontWeight: 800,
  color: "#9a3412",
  marginBottom: 10,
}

const slotCount = {
  fontSize: 34,
  fontWeight: 900,
  color: "#f97316",
  lineHeight: 1,
}

const slotLabel = {
  marginTop: 8,
  fontSize: 12,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
}

const catGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
}

const catCard = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 18,
}

const catTopRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 12,
}

const catShort = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 58,
  padding: "8px 12px",
  borderRadius: 999,
  background: "#f97316",
  color: "#ffffff",
  fontWeight: 800,
  fontSize: 13,
}

const catWeight = {
  fontSize: 13,
  fontWeight: 800,
  color: "#9a3412",
}

const catName = {
  fontSize: 17,
  fontWeight: 700,
  color: "#111827",
  lineHeight: 1.25,
}

const loadingBox = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 24,
}

const errorBox = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 24,
  color: "#9a3412",
}