import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { SIDELEAGUES } from "../config/sideleagues"

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function getTeamFromMatchup(matchup, targetName) {
  const target = normalizeName(targetName)
  const teams = Array.isArray(matchup?.teams) ? matchup.teams : []
  return teams.find((team) => normalizeName(team?.name) === target) || null
}

function getOpponentFromMatchup(matchup, targetName) {
  const target = normalizeName(targetName)
  const teams = Array.isArray(matchup?.teams) ? matchup.teams : []
  return teams.find((team) => normalizeName(team?.name) !== target) || null
}

function getResultLetter(row) {
  const w = Number(row?.w || 0)
  const l = Number(row?.l || 0)
  const t = Number(row?.t || 0)

  if (w > l) return "W"
  if (l > w) return "L"
  if (t > 0 && w === l) return "T"
  return "—"
}

function getComparableCategoryEntries(teamStats = {}, scoringCategories = []) {
  const statAliasMap = {
    PTS: ["points"],
    REB: ["reb", "rebounds"],
    AST: ["ast", "assists"],
    ST: ["st", "steals"],
    STL: ["st", "steals"],
    BLK: ["blk", "blocks"],
    FGM: ["fgm"],
    "FG%": ["fgPct"],
    FG: ["fgPct"],
    "3PTM": ["tpm"],
    "3PM": ["tpm"],
    TPM: ["tpm"],
    "3PT%": ["tpPct"],
    "3P%": ["tpPct"],
    "FT%": ["ftPct"],
    OREB: ["oreb"],
    DREB: ["dreb"],
    TO: ["to"],
    "A/TO": ["aTo"],
    "A/T": ["aTo"],
    "AST/TO": ["aTo"],
  }

  return scoringCategories
    .map((cat) => {
      const shortName = String(cat?.shortName || "").trim()
      if (!shortName) return null

      const aliases = statAliasMap[shortName] || []
      for (const key of aliases) {
        const value = teamStats?.[key]
        if (value != null && value !== "") {
          return {
            shortName,
            statKey: key,
            value: Number(value),
          }
        }
      }

      return null
    })
    .filter(Boolean)
}

function compareCategoryWins(teamAStats = {}, teamBStats = {}, scoringCategories = []) {
  const aEntries = getComparableCategoryEntries(teamAStats, scoringCategories)
  const result = []

  for (const entry of aEntries) {
    const aVal = Number(entry.value)
    const bRaw = teamBStats?.[entry.statKey]
    const bVal = bRaw == null || bRaw === "" ? null : Number(bRaw)

    if (!Number.isFinite(aVal) || !Number.isFinite(bVal)) continue

    let winner = "tie"

    if (entry.statKey === "to") {
      if (aVal < bVal) winner = "a"
      else if (bVal < aVal) winner = "b"
    } else {
      if (aVal > bVal) winner = "a"
      else if (bVal > aVal) winner = "b"
    }

    result.push({
      shortName: entry.shortName,
      statKey: entry.statKey,
      aVal,
      bVal,
      winner,
    })
  }

  return result
}

function ResultBadge({ value }) {
  const isWin = value === "W"
  const isLoss = value === "L"
  const isTie = value === "T"

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 32,
        height: 32,
        padding: "0 10px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 900,
        border: isWin
          ? "1px solid #86efac"
          : isLoss
            ? "1px solid #fca5a5"
            : "1px solid #fed7aa",
        background: isWin
          ? "#dcfce7"
          : isLoss
            ? "#fee2e2"
            : "#fff7ed",
        color: isWin
          ? "#166534"
          : isLoss
            ? "#991b1b"
            : "#9a3412",
      }}
    >
      {value}
    </span>
  )
}

export default function SideleagueTeamPage() {
  const { teamName } = useParams()
  const decodedTeamName = decodeURIComponent(teamName || "")

  const [payloads, setPayloads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        const matchupSideleagues = SIDELEAGUES.filter((item) => item.view === "matchup_rosters")

        const results = await Promise.all(
          matchupSideleagues.map(async (item) => {
            const jsonRes = await fetch(`/data/sideleagues/${item.key}.json`)
            const jsonText = await jsonRes.text()
            if (!jsonRes.ok) throw new Error(`Failed loading ${item.key}: ${jsonText}`)

            const apiRes = await fetch(
              `/api/sideleague?leagueId=${encodeURIComponent(item.leagueId)}&period=${encodeURIComponent(
                item.period || 1
              )}`
            )
            const apiText = await apiRes.text()
            if (!apiRes.ok) throw new Error(`Failed loading API for ${item.key}: ${apiText}`)

            return {
              config: item,
              data: JSON.parse(jsonText),
              live: JSON.parse(apiText),
            }
          })
        )

        if (!cancelled) setPayloads(results)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setPayloads([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const appearances = useMemo(() => {
    return payloads
      .map(({ config, data, live }) => {
        const allMatchups = Array.isArray(data?.matchups) ? data.matchups : []

        let matchedTeam = null
let matchedMatchup = null

for (const matchup of allMatchups) {
  const team = getTeamFromMatchup(matchup, decodedTeamName)
  if (team) {
    matchedTeam = team
    matchedMatchup = matchup
    break
  }
}

if (!matchedTeam || !matchedMatchup) return null

const configuredTeams = Array.isArray(config?.teams) ? config.teams : []
const normalizedCurrent = normalizeName(decodedTeamName)

let counterpartName = null
if (configuredTeams.length >= 2) {
  const [teamA, teamB] = configuredTeams
  if (normalizeName(teamA) === normalizedCurrent) counterpartName = teamB
  else if (normalizeName(teamB) === normalizedCurrent) counterpartName = teamA
}

let counterpartTeam = null

if (counterpartName) {
  for (const matchup of allMatchups) {
    const team = getTeamFromMatchup(matchup, counterpartName)
    if (team) {
      counterpartTeam = team
      break
    }
  }
}

// fallback to direct matchup opponent only if counterpart team was not found
if (!counterpartTeam) {
  counterpartTeam = getOpponentFromMatchup(matchedMatchup, decodedTeamName)
}

        if (!matchedTeam || !matchedMatchup) return null

        const categories =
          live?.leagueInfo?.scoringSystem?.scoringCategorySettings?.[0]?.configs?.map((cfg) => ({
            shortName: cfg?.scoringCategory?.shortName || "",
          })) || []

        const comparison = compareCategoryWins(
  matchedTeam?.stats || {},
  counterpartTeam?.stats || {},
  categories
)

const wins = comparison.filter((item) => item.winner === "a").length
const losses = comparison.filter((item) => item.winner === "b").length
const ties = comparison.filter((item) => item.winner === "tie").length

const resultLetter =
  wins > losses ? "W" :
  losses > wins ? "L" :
  ties > 0 ? "T" :
  "—"

return {
  key: config.key,
  name: config.name,
  seasonLabel: config.seasonLabel,
  w: matchedTeam?.w ?? 0,
  l: matchedTeam?.l ?? 0,
  t: matchedTeam?.t ?? 0,
  resultLetter,
  calculatedScore: `${wins}-${losses}${ties ? `-${ties}` : ""}`,
}
      })
      .filter(Boolean)
      .sort((a, b) => String(b.seasonLabel || "").localeCompare(String(a.seasonLabel || "")))
  }, [payloads, decodedTeamName])

  const totals = useMemo(() => {
    return appearances.reduce(
      (acc, row) => {
        acc.w += Number(row.w || 0)
        acc.l += Number(row.l || 0)
        acc.t += Number(row.t || 0)
        return acc
      },
      { w: 0, l: 0, t: 0 }
    )
  }, [appearances])

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
      <div style={{ marginBottom: 16 }}>
        <Link to="/sideleagues" style={{ color: "#ea580c", fontWeight: 700 }}>
          ← Back to Sideleagues
        </Link>
      </div>

      <section
        style={{
          background: "#ffffff",
          border: "1px solid #fed7aa",
          borderRadius: 24,
          padding: 24,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            padding: "8px 12px",
            borderRadius: 999,
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            color: "#ea580c",
            fontWeight: 800,
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Sideleague Team
        </div>

        <h1 style={{ margin: "14px 0 8px", fontSize: "clamp(28px, 4vw, 40px)" }}>
          {decodedTeamName}
        </h1>

        <p style={{ margin: 0, color: "#6b7280", lineHeight: 1.6 }}>
          Total record across sideleague appearances: {totals.w}-{totals.l}-{totals.t}
        </p>
      </section>

      {loading ? (
        <div style={box}>Loading sideleague team history...</div>
      ) : error ? (
        <div style={errorBox}>{error}</div>
      ) : (
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #fed7aa",
            borderRadius: 24,
            padding: 20,
          }}
        >
          <h2 style={{ margin: "0 0 14px", fontSize: 24 }}>Appearances</h2>

          {!appearances.length ? (
            <div style={{ color: "#6b7280" }}>No sideleague appearances found.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Sideleague</th>
                    <th style={th}>Season</th>
                    <th style={th}>Result</th>
                    <th style={th}>Calculated Result</th>
                  </tr>
                </thead>
                <tbody>
                  {appearances.map((row) => (
                    <tr key={row.key}>
                      <td style={td}>
                        <Link
                          to={`/sideleagues/${row.key}`}
                          style={{ color: "#111827", fontWeight: 700, textDecoration: "none" }}
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td style={td}>{row.seasonLabel}</td>
                      <td style={td}>
                        <ResultBadge value={row.resultLetter} />
                      </td>
                      <td style={td}>{row.calculatedScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  )
}

const th = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #fed7aa",
  color: "#6b7280",
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
}

const td = {
  padding: "12px",
  borderBottom: "1px solid #ffedd5",
  color: "#111827",
}

const box = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 18,
}

const errorBox = {
  ...box,
  color: "#b91c1c",
  background: "#fff7f7",
  border: "1px solid #fecaca",
}