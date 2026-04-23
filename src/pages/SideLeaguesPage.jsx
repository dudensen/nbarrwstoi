import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { SIDELEAGUES } from "../config/sideleagues"

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function getThemeForLeague(league) {
  const text = normalizeText(`${league?.name || ""} ${league?.description || ""}`)

  if (text.includes("playoff")) {
    return "Playoffs"
  }

  if (
    text.includes("asg") ||
    text.includes("all star") ||
    text.includes("rising star") ||
    text.includes("veteran star") ||
    text.includes("3pts") ||
    text.includes("3-point") ||
    text.includes("3 on 3") ||
    text.includes("3-on-3") ||
    text.includes("contest")
  ) {
    return "All-Star Events"
  }

  if (text.includes("euroleague") || text.includes("konti")) {
    return "Special Formats"
  }

  return "Other"
}

function getSeasonSortValue(seasonLabel) {
  const match = String(seasonLabel || "").match(/(\d{4})-(\d{2})/)
  if (!match) return -1
  return Number(`${match[1]}${match[2]}`)
}

function buildGroupedSideleagues(leagues = []) {
  const byName = new Map()

  for (const league of leagues) {
    const name = String(league?.name || "").trim()
    if (!name) continue

    if (!byName.has(name)) {
      byName.set(name, {
        id: name,
        name,
        theme: getThemeForLeague(league),
        description: league?.description || "",
        entries: [],
      })
    }

    const group = byName.get(name)
    if (!group.description && league?.description) {
      group.description = league.description
    }

    group.entries.push(league)
  }

  const groups = Array.from(byName.values()).map((group) => ({
    ...group,
    entries: [...group.entries].sort(
      (a, b) => getSeasonSortValue(b?.seasonLabel) - getSeasonSortValue(a?.seasonLabel)
    ),
  }))

  const sections = new Map()

  for (const group of groups) {
    if (!sections.has(group.theme)) {
      sections.set(group.theme, [])
    }
    sections.get(group.theme).push(group)
  }

  const themeOrder = ["Playoffs", "All-Star Events", "Special Formats", "Other"]

  return themeOrder
    .map((theme) => ({
      theme,
      groups: (sections.get(theme) || []).sort((a, b) => {
        const aLatest = getSeasonSortValue(a.entries?.[0]?.seasonLabel)
        const bLatest = getSeasonSortValue(b.entries?.[0]?.seasonLabel)
        if (bLatest !== aLatest) return bLatest - aLatest
        return a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      }),
    }))
    .filter((section) => section.groups.length > 0)
}

function GroupedLeagueCard({ group }) {
  const [selectedKey, setSelectedKey] = useState(group.entries?.[0]?.key || "")

  const selectedLeague =
    group.entries.find((entry) => entry.key === selectedKey) || group.entries?.[0] || null

  if (!selectedLeague) return null

  return (
    <article style={card}>
      <div style={cardTopRow}>
        <span style={seasonPill}>
          {group.entries.length > 1 ? `${group.entries.length} seasons` : selectedLeague.seasonLabel}
        </span>

        {group.entries.length > 1 ? (
          <select
            value={selectedLeague.key}
            onChange={(e) => setSelectedKey(e.target.value)}
            style={seasonSelect}
            aria-label={`${group.name} season selector`}
          >
            {group.entries.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.seasonLabel}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <h2 style={cardTitle}>{group.name}</h2>

      <p style={cardDescription}>{selectedLeague.description || group.description || "—"}</p>

      <div style={cardFooter}>
        <div style={seasonMeta}>
          {group.entries.length > 1 ? `Viewing ${selectedLeague.seasonLabel}` : "Single edition"}
        </div>

        <Link to={`/sideleagues/${selectedLeague.key}`} style={openButton}>
          Open
        </Link>
      </div>
    </article>
  )
}

export default function SideLeaguesPage() {
  const sections = useMemo(() => buildGroupedSideleagues(SIDELEAGUES), [])
  const totalLeagues = SIDELEAGUES.length
  const groupedCount = sections.reduce((sum, section) => sum + section.groups.length, 0)

  return (
    <main style={main}>
      <section style={heroCard}>
        <div style={eyebrow}>Side Leagues</div>

        <h1 style={heroTitle}>Side Projects & Side Leagues</h1>

        <p style={heroText}>
          Extra competitions, one-off events, and special formats outside the main league.
        </p>

        <div style={summaryRow}>
          <div style={summaryChip}>{groupedCount} grouped competitions</div>
          <div style={summaryChip}>{totalLeagues} total editions</div>
        </div>
      </section>

      <div style={sectionsWrap}>
        {sections.map((section) => (
          <section key={section.theme} style={themeSection}>
            <div style={themeHeader}>
              <div>
                <div style={themeEyebrow}>{section.theme}</div>
              </div>

              <div style={themeCount}>
                {section.groups.length} {section.groups.length === 1 ? "competition" : "competitions"}
              </div>
            </div>

            <div style={grid}>
              {section.groups.map((group) => (
                <GroupedLeagueCard key={group.id} group={group} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}

const main = {
  maxWidth: 1200,
  margin: "0 auto",
  padding: "32px 20px 44px",
}

const heroCard = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 24,
  padding: 24,
  marginBottom: 24,
  boxShadow: "0 14px 34px rgba(17, 24, 39, 0.08)",
}

const eyebrow = {
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
}

const heroTitle = {
  margin: "14px 0 8px",
  fontSize: "clamp(28px, 4vw, 40px)",
  color: "#111827",
}

const heroText = {
  margin: 0,
  color: "#6b7280",
  lineHeight: 1.6,
}

const summaryRow = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  marginTop: 18,
}

const summaryChip = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid #fed7aa",
  background: "#fffaf5",
  color: "#9a3412",
  fontWeight: 700,
  fontSize: 13,
}

const sectionsWrap = {
  display: "grid",
  gap: 22,
}

const themeSection = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 24,
  padding: 20,
  boxShadow: "0 14px 34px rgba(17, 24, 39, 0.08)",
}

const themeHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 16,
}

const themeEyebrow = {
  color: "#f97316",
  fontWeight: 800,
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 6,
}


const themeCount = {
  color: "#6b7280",
  fontWeight: 700,
}

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 16,
}

const card = {
  background: "#fffaf5",
  border: "1px solid #fed7aa",
  borderRadius: 22,
  padding: 18,
  display: "flex",
  flexDirection: "column",
  minHeight: 220,
}

const cardTopRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 12,
}

const seasonPill = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  background: "#ffffff",
  border: "1px solid #fed7aa",
  color: "#ea580c",
  fontWeight: 800,
  fontSize: 12,
  padding: "6px 10px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
}

const seasonSelect = {
  minWidth: 110,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid #fdba74",
  background: "#ffffff",
  color: "#9a3412",
  fontWeight: 700,
}

const cardTitle = {
  margin: "0 0 10px",
  fontSize: 22,
  fontWeight: 800,
  color: "#111827",
}

const cardDescription = {
  margin: 0,
  color: "#6b7280",
  lineHeight: 1.65,
  flex: 1,
}

const cardFooter = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 18,
}

const seasonMeta = {
  color: "#6b7280",
  fontWeight: 600,
  fontSize: 14,
}

const openButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 14px",
  borderRadius: 999,
  background: "#f97316",
  color: "#ffffff",
  fontWeight: 800,
  textDecoration: "none",
  minWidth: 86,
}