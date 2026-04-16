import { useMemo, useState } from "react"

const SIDE_LEAGUES = [
  {
    id: "dynasty-cup",
    name: "Dynasty Cup",
    description:
      "A separate NBArrwstoi side league with its own rules, teams, standings and draft history.",
    status: "Active",
    links: {
      rules: "/sideleagues/dynasty-cup/rules",
      draftResults: "/sideleagues/dynasty-cup/draft-results",
      teams: "/sideleagues/dynasty-cup/teams",
      standings: "/sideleagues/dynasty-cup/standings",
    },
  },
  {
    id: "keeper-lab",
    name: "Keeper Lab",
    description:
      "Experimental keeper side league with independent standings and team pages.",
    status: "Coming Soon",
    links: {
      rules: "",
      draftResults: "",
      teams: "",
      standings: "",
    },
  },
]

function LinkPill({ label, href }) {
  const disabled = !href

  if (disabled) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "10px 14px",
          borderRadius: 999,
          border: "1px solid #fed7aa",
          background: "#fff7ed",
          color: "#9a3412",
          fontWeight: 700,
          fontSize: 14,
          opacity: 0.75,
        }}
      >
        {label}
      </span>
    )
  }

  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px 14px",
        borderRadius: 999,
        border: "1px solid #fed7aa",
        background: "#ffffff",
        color: "#ea580c",
        fontWeight: 700,
        fontSize: 14,
        textDecoration: "none",
      }}
    >
      {label}
    </a>
  )
}

function LeagueCard({ league }) {
  return (
    <article
      style={{
        background: "#ffffff",
        border: "1px solid #fed7aa",
        borderRadius: 24,
        padding: 22,
        boxShadow: "0 14px 34px rgba(17, 24, 39, 0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "#fff7ed",
              color: "#ea580c",
              border: "1px solid #fed7aa",
              padding: "7px 11px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 10,
            }}
          >
            Side League
          </div>

          <h2 style={{ margin: 0, fontSize: 28, color: "#111827" }}>
            {league.name}
          </h2>
        </div>

        <div
          style={{
            background: league.status === "Active" ? "#ecfdf5" : "#fff7ed",
            color: league.status === "Active" ? "#166534" : "#9a3412",
            border: `1px solid ${
              league.status === "Active" ? "#bbf7d0" : "#fed7aa"
            }`,
            borderRadius: 999,
            padding: "8px 12px",
            fontWeight: 800,
            fontSize: 13,
          }}
        >
          {league.status}
        </div>
      </div>

      <p style={{ margin: "0 0 18px", color: "#6b7280", lineHeight: 1.65 }}>
        {league.description}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        <LinkPill label="Rules" href={league.links?.rules} />
        <LinkPill label="Draft Results" href={league.links?.draftResults} />
        <LinkPill label="Teams" href={league.links?.teams} />
        <LinkPill label="Standings" href={league.links?.standings} />
      </div>
    </article>
  )
}

export default function SideLeaguesPage() {
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    const q = String(search || "").trim().toLowerCase()
    if (!q) return SIDE_LEAGUES

    return SIDE_LEAGUES.filter((league) =>
      [league.name, league.description, league.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [search])

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
      <section
        style={{
          background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)",
          color: "#ffffff",
          borderRadius: 24,
          padding: "28px 28px 30px",
          marginBottom: 24,
          boxShadow: "0 18px 40px rgba(249,115,22,0.18)",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.95,
            marginBottom: 10,
          }}
        >
          NBArrwstoi Universe
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: "clamp(28px, 4vw, 40px)",
            lineHeight: 1.05,
          }}
        >
          Side Leagues
        </h1>

        <p
          style={{
            margin: "12px 0 0",
            fontSize: 16,
            opacity: 0.96,
            maxWidth: 820,
            lineHeight: 1.6,
          }}
        >
          Browse all side leagues and jump directly into their rules, draft
          results, teams and standings.
        </p>
      </section>

      <section
        style={{
          background: "#ffffff",
          border: "1px solid #fed7aa",
          borderRadius: 20,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search side leagues..."
          style={{
            width: "100%",
            border: "1px solid #fdba74",
            borderRadius: 14,
            padding: "12px 14px",
            fontSize: 15,
            outline: "none",
          }}
        />
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 18,
        }}
      >
        {filtered.map((league) => (
          <LeagueCard key={league.id} league={league} />
        ))}
      </section>
    </main>
  )
}