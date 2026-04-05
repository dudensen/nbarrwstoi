import { useEffect, useMemo, useState } from "react"
import { useSeason } from "../context/SeasonContext"

const KNOWN_TITLES = new Set([
  "Δομή",
  "Συνθέσεις",
  "Πρόγραμμα",
  "Offseason Keepers",
  "Draft",
  "Waiver wire/ Free Agency",
  "Παίκτες 5ετίας",
  "Trades – Vetos",
  "Polls",
  "Tie Brakers",
  "League Managers",
  "Manager Veto",
  "Επίλογος",
])

function formatValue(value) {
  if (value == null || value === "") return "—"
  return String(value)
}

function slugifyHeading(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9α-ωάέήίόύώϊΐϋΰ]+/gi, "-")
    .replace(/^-+|-+$/g, "")
}

function normalizeLine(value = "") {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
}

function isNoiseLine(line = "") {
  const clean = normalizeLine(line).toLowerCase()
  if (!clean) return true

  return [
    "publicada con documentos de google",
    "published using google docs",
    "actualizado automáticamente cada 5 minutos",
    "updated automatically every 5 minutes",
    "denunciar uso inadecuado",
    "report abuse",
    "más información",
    "learn more",
    "nbarrwstoi-const.docx",
  ].includes(clean)
}

function extractConstitutionLines(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter((line) => !isNoiseLine(line))
}

function isHeadingLine(line = "") {
  return KNOWN_TITLES.has(normalizeLine(line))
}

function parseConstitutionSections(text = "") {
  const lines = extractConstitutionLines(text)
  if (!lines.length) return []

  const sections = []
  let currentSection = null

  const flushSection = () => {
    if (!currentSection) return

    currentSection.items = currentSection.items
      .map((item) => normalizeLine(item))
      .filter(Boolean)

    if (currentSection.title && currentSection.items.length) {
      sections.push(currentSection)
    }

    currentSection = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = normalizeLine(lines[i])
    if (!line) continue

    if (line.toLowerCase() === "nba arrwstoi league rules and regulations") {
      continue
    }

    if (isHeadingLine(line)) {
      flushSection()
      currentSection = {
        id: slugifyHeading(line),
        title: line,
        items: [],
      }
      continue
    }

    if (!currentSection) continue
    currentSection.items.push(line)
  }

  flushSection()
  return sections
}

function ConstitutionMenu({ sections = [] }) {
  if (!sections.length) return null

  return (
    <aside style={constitutionMenu}>
      <div style={constitutionMenuTitle}>Articles</div>
      <nav style={constitutionMenuList}>
        {sections.map((section) => (
          <a key={section.id} href={`#${section.id}`} style={constitutionMenuLink}>
            {section.title}
          </a>
        ))}
      </nav>
    </aside>
  )
}

function ConstitutionSectionCard({ section }) {
  return (
    <section id={section.id} style={constitutionSectionCard}>
      <h3 style={constitutionSectionTitle}>{section.title}</h3>

      <div style={constitutionItemsWrap}>
        {section.items.map((item, idx) => (
          <div key={`${section.id}-${idx}`} style={constitutionItemCard}>
            <div style={constitutionItemText}>{item}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function LeagueRulesPage() {
  const { season } = useSeason()

  const [leagueInfo, setLeagueInfo] = useState(null)
  const [constitutionText, setConstitutionText] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        const [leagueRes, constitutionRes] = await Promise.all([
          fetch(`/api/league-info?season=${encodeURIComponent(season.key)}`),
          fetch(`/api/constitution`),
        ])

        const [leagueText, constitutionPlainText] = await Promise.all([
          leagueRes.text(),
          constitutionRes.text(),
        ])

        if (!leagueRes.ok) {
          throw new Error(`League info failed (${leagueRes.status}): ${leagueText}`)
        }

        if (!constitutionRes.ok) {
          throw new Error(`Constitution failed (${constitutionRes.status}): ${constitutionPlainText}`)
        }

        if (!cancelled) {
          setLeagueInfo(JSON.parse(leagueText))
          setConstitutionText(constitutionPlainText)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setLeagueInfo(null)
          setConstitutionText("")
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

  const constitutionSections = useMemo(
    () => parseConstitutionSections(constitutionText),
    [constitutionText]
  )

  const data = useMemo(() => {
    const rosterInfo = leagueInfo?.rosterInfo || {}
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
      leagueName: leagueInfo?.leagueName || "League Rules",
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
          Active lineup slots, scoring categories, and constitution.
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
              <h2 style={sectionTitle}>Active Lineup Slots</h2>
              <p style={sectionSub}>
                How many active players can be placed in each slot.
              </p>
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

          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>Constitution</h2>
              <p style={sectionSub}>Synced from the published Google Doc.</p>
            </div>

            <div style={constitutionLayout}>
              <ConstitutionMenu sections={constitutionSections} />

              <div style={constitutionContent}>
                {constitutionSections.length ? (
                  constitutionSections.map((section) => (
                    <ConstitutionSectionCard key={section.id} section={section} />
                  ))
                ) : (
                  <div style={emptyBox}>No constitution sections were detected.</div>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  )
}

const main = {
  maxWidth: 1200,
  margin: "0 auto",
  padding: "32px 20px",
}

const hero = {
  background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)",
  color: "#ffffff",
  borderRadius: 24,
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
  margin: "12px 0 0",
  fontSize: 16,
  opacity: 0.96,
  maxWidth: 760,
}

const section = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 24,
  padding: 20,
  marginBottom: 24,
}

const sectionHeader = {
  marginBottom: 16,
}

const sectionTitle = {
  margin: 0,
  fontSize: 22,
  color: "#111827",
}

const sectionSub = {
  margin: "8px 0 0",
  color: "#6b7280",
  fontSize: 14,
}

const loadingBox = {
  background: "#ffffff",
  border: "1px solid #fed7aa",
  borderRadius: 20,
  padding: 24,
  color: "#374151",
}

const errorBox = {
  background: "#fff7ed",
  border: "1px solid #fdba74",
  color: "#9a3412",
  borderRadius: 20,
  padding: 24,
}

const emptyBox = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 18,
  padding: 18,
  color: "#6b7280",
}

const constitutionLayout = {
  display: "grid",
  gridTemplateColumns: "280px minmax(0, 1fr)",
  gap: 20,
  alignItems: "start",
}

const constitutionMenu = {
  position: "sticky",
  top: 20,
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 18,
  padding: 16,
}

const constitutionMenuTitle = {
  fontSize: 13,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#9a3412",
  marginBottom: 12,
}

const constitutionMenuList = {
  display: "grid",
  gap: 8,
}

const constitutionMenuLink = {
  display: "block",
  padding: "10px 12px",
  borderRadius: 12,
  background: "#ffffff",
  border: "1px solid #ffedd5",
  color: "#374151",
  fontSize: 14,
  fontWeight: 600,
}

const constitutionContent = {
  display: "grid",
  gap: 16,
}

const constitutionSectionCard = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 18,
  padding: 20,
  scrollMarginTop: 24,
}

const constitutionSectionTitle = {
  margin: "0 0 14px",
  fontSize: 20,
  color: "#111827",
}

const constitutionItemsWrap = {
  display: "grid",
  gap: 10,
}

const constitutionItemCard = {
  background: "#ffffff",
  border: "1px solid #ffedd5",
  borderRadius: 14,
  padding: 12,
}

const constitutionItemText = {
  color: "#374151",
  lineHeight: 1.7,
  fontWeight: 500,
  fontSize: 15,
}

const constitutionSubList = {
  display: "grid",
  gap: 8,
  marginTop: 10,
  paddingLeft: 22,
}

const constitutionSubItem = {
  color: "#6b7280",
  lineHeight: 1.7,
  borderLeft: "3px solid #fed7aa",
  paddingLeft: 12,
}

const slotGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
  gap: 10,
}

const slotCard = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 14,
  padding: 12,
  textAlign: "center",
}

const slotName = {
  fontSize: 12,
  fontWeight: 800,
  color: "#9a3412",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
}

const slotCount = {
  fontSize: 24,
  lineHeight: 1,
  fontWeight: 900,
  color: "#111827",
  marginTop: 8,
}

const slotLabel = {
  fontSize: 11,
  color: "#6b7280",
  marginTop: 6,
}

const catGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 10,
}

const catCard = {
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  borderRadius: 14,
  padding: 12,
}

const catTopRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  marginBottom: 8,
}

const catShort = {
  fontSize: 12,
  fontWeight: 800,
  color: "#f97316",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
}

const catWeight = {
  fontSize: 12,
  fontWeight: 800,
  color: "#9a3412",
}

const catName = {
  fontSize: 14,
  fontWeight: 700,
  color: "#111827",
}