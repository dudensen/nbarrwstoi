import { useEffect, useMemo, useState } from "react"

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1_gypBxbR8I68ey9CBMXMaQ3lhTWrXlJtV2katNoAyuc/export?format=csv&gid=0"

function parseCsv(text = "") {
  const rows = []
  let current = []
  let value = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        value += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === "," && !inQuotes) {
      current.push(value)
      value = ""
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++
      current.push(value)
      rows.push(current)
      current = []
      value = ""
    } else {
      value += ch
    }
  }

  if (value.length || current.length) {
    current.push(value)
    rows.push(current)
  }

  return rows
}

function clean(value) {
  return String(value ?? "").trim()
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function titleCase(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function compareValues(a, b) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1

  if (typeof a === "number" && typeof b === "number") {
    return a - b
  }

  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  })
}


function SortableHeader({ label, columnKey, sortConfig, onSort }) {
  const active = sortConfig.key === columnKey
  const arrow = !active ? "↕" : sortConfig.direction === "asc" ? "▲" : "▼"

  return (
    <th style={th}>
      <button type="button" onClick={() => onSort(columnKey)} style={sortBtn}>
        <span>{label}</span>
        <span style={{ fontSize: 11 }}>{arrow}</span>
      </button>
    </th>
  )
}

function PodiumCard({ place, teams, wins }) {
  const heights = {
    1: 180,
    2: 145,
    3: 120,
  }

  const labels = {
    1: "1st",
    2: "2nd",
    3: "3rd",
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
      }}
    >
      <div
        style={{
          marginBottom: 10,
          textAlign: "center",
          minHeight: 64,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18, color: "#111827" }}>
          {teams.map((t) => t.team).join(", ")}
        </div>
        <div style={{ color: "#9a3412", fontWeight: 700, marginTop: 4 }}>
          {wins} wins
          {teams.length > 1 ? ` · ${teams.length} players` : ""}
        </div>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 260,
          height: heights[place],
          borderRadius: "22px 22px 0 0",
          background:
            place === 1
              ? "linear-gradient(180deg, #fb923c 0%, #f97316 100%)"
              : place === 2
              ? "linear-gradient(180deg, #d1d5db 0%, #9ca3af 100%)"
              : "linear-gradient(180deg, #fdba74 0%, #c2410c 100%)",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 16px 30px rgba(0,0,0,0.12)",
          padding: "0 14px",
          boxSizing: "border-box",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 800, opacity: 0.95 }}>
          {labels[place]}
        </div>
        <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1, marginTop: 6 }}>
          {place}
        </div>
      </div>
    </div>
  )
}

export default function ThemeAwardsPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [sortConfig, setSortConfig] = useState({ key: "total", direction: "desc" })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        const res = await fetch(SHEET_CSV_URL)
        const text = await res.text()

        if (!res.ok) {
          throw new Error(`Sheet fetch failed (${res.status})`)
        }

        if (!cancelled) {
          setRows(parseCsv(text))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setRows([])
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

  const data = useMemo(() => {
    if (!rows.length) {
      return {
        title: "",
        headerRow: [],
        eras: [],
        teamRows: [],
        totalsRow: null,
        podium: [],
        eraCards: [],
        grandTotal: 0,
      }
    }

    const title = clean(rows[0]?.[0]) || "Theme Awards"
    const headerRow = rows[1] || []

    const rawBody = rows.slice(2).filter((row) => row.some((cell) => clean(cell)))

    const totalsRowRaw =
      rawBody.find((row) => clean(row[0]).toUpperCase() === "ALL") || null

    const teamRowsRaw = rawBody.filter((row) => clean(row[0]).toUpperCase() !== "ALL")

    const totalColIndex = headerRow.findIndex(
      (cell) => clean(cell).toLowerCase() === "total"
    )

    const eras = headerRow
      .slice(1)
      .map((name, idx) => ({
        key: clean(name).toLowerCase(),
        label: titleCase(name),
        index: idx + 1,
      }))
      .filter((item) => item.key && item.key !== "total")

    const teamRows = teamRowsRaw
      .map((row) => {
        const team = clean(row[0])
        if (!team) return null

        const values = {}
        for (const era of eras) {
          values[era.key] = num(row[era.index])
        }

        const total = totalColIndex >= 0 ? num(row[totalColIndex]) : 0

        return {
          id: team.toLowerCase().replace(/\s+/g, "-"),
          team,
          total,
          values,
          row,
        }
      })
      .filter(Boolean)

    const podium = (() => {
  const sorted = [...teamRows].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return a.team.localeCompare(b.team, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  })

  const groups = []
  for (const row of sorted) {
    const lastGroup = groups[groups.length - 1]
    if (!lastGroup || lastGroup.wins !== row.total) {
      groups.push({
        wins: row.total,
        teams: [row],
      })
    } else {
      lastGroup.teams.push(row)
    }
  }

  return groups.slice(0, 3).map((group, idx) => ({
    place: idx + 1,
    wins: group.wins,
    teams: group.teams,
  }))
})()

    const eraCards = eras
  .map((era) => {
    const totalGames = totalsRowRaw ? num(totalsRowRaw[era.index]) : 0
    const maxWins = Math.max(...teamRows.map((row) => row.values[era.key] ?? 0), 0)
    const leaders = teamRows.filter((row) => (row.values[era.key] ?? 0) === maxWins)

    return {
      ...era,
      totalGames,
      maxWins,
      leaders,
      tied: leaders.length > 1,
    }
  })
  .sort((a, b) => {
    if (b.totalGames !== a.totalGames) return b.totalGames - a.totalGames
    return a.label.localeCompare(b.label, undefined, {
      sensitivity: "base",
      numeric: true,
    })
  })

    const grandTotal =
      totalsRowRaw && totalColIndex >= 0 ? num(totalsRowRaw[totalColIndex]) : 0

    return {
      title,
      headerRow,
      eras,
      teamRows,
      totalsRow: totalsRowRaw,
      podium,
      eraCards,
      grandTotal,
    }
  }, [rows])

  const sortedTableRows = useMemo(() => {
    return sortRows(data.teamRows, sortConfig)
  }, [data.teamRows, sortConfig])

  function handleSort(columnKey) {
    setSortConfig((prev) => ({
      key: columnKey,
      direction:
        prev.key === columnKey && prev.direction === "desc" ? "asc" : "desc",
    }))
  }

  return (
    <main style={main}>
      <section style={hero}>
        <div style={eyebrow}>ΠΟΥΤΣΑΞΥΛΟΚΑΙΤΟΥΛΙΠΕΣ</div>
        <h1 style={heroTitle}>The War Room</h1>
        <p style={heroSub}>
        Τις βγάλαμε, τις παίξαμε, τις παρουσιάζουμε.
        </p>
      </section>

      {loading ? (
        <div style={infoBox}>Loading sheet...</div>
      ) : error ? (
        <div style={errorBox}>{error}</div>
      ) : (
        <>
          <section style={summaryGrid}>
            <div style={summaryCard}>
              <div style={summaryLabel}>Total games</div>
              <div style={summaryValue}>{data.grandTotal}</div>
            </div>
            <div style={summaryCard}>
              <div style={summaryLabel}>Players</div>
              <div style={summaryValue}>{data.teamRows.length}</div>
            </div>
            <div style={summaryCard}>
              <div style={summaryLabel}>Eras</div>
              <div style={summaryValue}>{data.eraCards.length}</div>
            </div>
          </section>

          <section style={section}>
  <div style={sectionHeader}>
    <h2 style={sectionTitle}>Tulip Champions</h2>
    <p style={sectionSub}>Total Wins</p>
  </div>

  <div style={podiumWrap}>
  {[2, 1, 3].map((place) => {
    const entry = data.podium.find((item) => item.place === place)

    return entry ? (
      <PodiumCard
        key={`place-${entry.place}`}
        place={entry.place}
        teams={entry.teams}
        wins={entry.wins}
      />
    ) : (
      <div key={`place-${place}`} />
    )
  })}
</div>
</section>

          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>Era Leaders</h2>
              <p style={sectionSub}>
                How many games were played in each era and who leads it.
              </p>
            </div>

            <div style={eraGrid}>
              {data.eraCards.map((era) => (
                <div key={era.key} style={eraCard}>
                  <div style={eraTop}>
                    <div style={eraName}>{era.label}</div>
                    <div style={eraGames}>{era.totalGames} games</div>
                  </div>

                  <div style={leaderBox}>
                    <div style={leaderLabel}>Most wins</div>

                    {era.maxWins <= 0 ? (
                      <div style={leaderValue}>No wins yet</div>
                    ) : era.tied ? (
                      <>
                        <div style={leaderValue}>
                          {era.maxWins} wins · {era.leaders.length} teams
                        </div>
                        <div style={leaderTeams}>
                          {era.leaders.map((t) => t.team).join(", ")}
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={leaderValue}>{era.leaders[0]?.team}</div>
                        <div style={leaderTeams}>{era.maxWins} wins</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>Full Table</h2>
              <p style={sectionSub}>Complete sheet data with sortable columns.</p>
            </div>

            <div style={tableCard}>
              <div style={tableWrap}>
                <table style={table}>
                  <thead>
                    <tr style={theadRow}>
                      <SortableHeader
                        label="Player"
                        columnKey="team"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                      {data.eras.map((era) => (
                        <SortableHeader
                          key={era.key}
                          label={era.label}
                          columnKey={`era:${era.key}`}
                          sortConfig={sortConfig}
                          onSort={handleSort}
                        />
                      ))}
                      <SortableHeader
                        label="Total"
                        columnKey="total"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                      />
                    </tr>
                  </thead>

                  <tbody>
                    {sortedTableRows.map((item) => (
                      <tr key={item.id}>
                        <td style={tdTeam}>{item.team}</td>
                        {data.eras.map((era) => (
                          <td key={era.key} style={td}>
                            {item.values[era.key]}
                          </td>
                        ))}
                        <td style={tdTotal}>{item.total}</td>
                      </tr>
                    ))}

                    {data.totalsRow ? (
                      <tr style={totalsRowStyle}>
                        <td style={tdTeam}>ALL</td>
                        {data.eras.map((era) => (
                          <td key={era.key} style={td}>
                            {num(data.totalsRow[era.index])}
                          </td>
                        ))}
                        <td style={tdTotal}>{data.grandTotal}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  )
}

function sortRows(rows, sortConfig) {
  return [...rows].sort((a, b) => {
    let aValue
    let bValue

    if (sortConfig.key === "team") {
      aValue = a.team
      bValue = b.team
    } else if (sortConfig.key === "total") {
      aValue = a.total
      bValue = b.total
    } else if (String(sortConfig.key).startsWith("era:")) {
      const eraKey = String(sortConfig.key).slice(4)
      aValue = a.values[eraKey] ?? 0
      bValue = b.values[eraKey] ?? 0
    } else {
      aValue = a.total
      bValue = b.total
    }

    const result = compareValues(aValue, bValue)
    return sortConfig.direction === "asc" ? result : -result
  })
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
  opacity: 0.96,
  maxWidth: 760,
}

const infoBox = {
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

const summaryGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 16,
  marginBottom: 24,
}

const summaryCard = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 22,
  padding: 20,
}

const summaryLabel = {
  fontSize: 13,
  fontWeight: 800,
  color: "#f97316",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 8,
}

const summaryValue = {
  fontSize: 28,
  fontWeight: 900,
  color: "#111827",
}

const section = {
  marginBottom: 28,
}

const sectionHeader = {
  marginBottom: 14,
}

const sectionTitle = {
  margin: 0,
  fontSize: 24,
  color: "#111827",
}

const sectionSub = {
  margin: "6px 0 0",
  color: "#6b7280",
}

const podiumWrap = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(180px, 1fr))",
  gap: 18,
  alignItems: "end",
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 24,
  padding: "24px 20px 0",
}

const eraGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
  gap: 16,
}

const eraCard = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 22,
  padding: 18,
  boxShadow: "0 10px 24px rgba(15,23,42,0.05)",
}

const eraTop = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
  marginBottom: 14,
}

const eraName = {
  fontSize: 18,
  fontWeight: 800,
  color: "#111827",
}

const eraGames = {
  fontSize: 13,
  fontWeight: 700,
  color: "#9a3412",
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 999,
  padding: "6px 10px",
  whiteSpace: "nowrap",
}

const leaderBox = {
  background: "#fffaf5",
  border: "1px solid #ffedd5",
  borderRadius: 18,
  padding: 14,
}

const leaderLabel = {
  fontSize: 12,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#f97316",
  marginBottom: 8,
}

const leaderValue = {
  fontSize: 20,
  fontWeight: 900,
  color: "#111827",
  lineHeight: 1.15,
}

const leaderTeams = {
  marginTop: 8,
  color: "#6b7280",
  lineHeight: 1.5,
}

const tableCard = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 24,
  padding: 18,
}

const tableWrap = {
  overflowX: "auto",
}

const table = {
  width: "100%",
  borderCollapse: "collapse",
}

const theadRow = {
  background: "#fff7ed",
}

const th = {
  padding: 0,
  borderBottom: "1px solid #fed7aa",
  textAlign: "left",
  whiteSpace: "nowrap",
}

const sortBtn = {
  width: "100%",
  background: "transparent",
  border: 0,
  cursor: "pointer",
  padding: "12px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  fontWeight: 800,
  color: "#9a3412",
}

const td = {
  padding: "12px 14px",
  borderBottom: "1px solid #ffedd5",
  textAlign: "center",
  color: "#374151",
}

const tdTeam = {
  padding: "12px 14px",
  borderBottom: "1px solid #ffedd5",
  textAlign: "left",
  color: "#111827",
  fontWeight: 700,
  whiteSpace: "nowrap",
}

const tdTotal = {
  padding: "12px 14px",
  borderBottom: "1px solid #ffedd5",
  textAlign: "center",
  color: "#111827",
  fontWeight: 800,
}

const totalsRowStyle = {
  background: "#fff7ed",
}