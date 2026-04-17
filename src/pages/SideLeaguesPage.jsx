import { Link } from "react-router-dom"
import { SIDELEAGUES } from "../config/sideleagues"

export default function SideLeaguesPage() {
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
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
          Side Leagues
        </div>

        <h1 style={{ margin: "14px 0 8px", fontSize: "clamp(28px, 4vw, 40px)" }}>
          Side Projects & Side Leagues
        </h1>

        <p style={{ margin: 0, color: "#6b7280", lineHeight: 1.6 }}>
          Extra competitions, one-off events, and special formats outside the main league.
        </p>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {SIDELEAGUES.map((league) => (
          <Link
            key={league.key}
            to={`/sideleagues/${league.key}`}
            style={{
              background: "#ffffff",
              border: "1px solid #fed7aa",
              borderRadius: 24,
              padding: 20,
              boxShadow: "0 14px 34px rgba(17, 24, 39, 0.08)",
            }}
          >
            <div
              style={{
                color: "#f97316",
                fontWeight: 800,
                fontSize: 13,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 8,
              }}
            >
              {league.seasonLabel}
            </div>

            <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>
              {league.name}
            </div>

            <div style={{ color: "#6b7280", marginTop: 8, lineHeight: 1.6 }}>
              {league.description}
            </div>
          </Link>
        ))}
      </section>
    </main>
  )
}