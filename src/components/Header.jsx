import { NavLink } from "react-router-dom"
import SeasonSelector from "./SeasonSelector"

const LINKS = [
  ["/", "Home"],
  ["/standings", "Standings"],
  ["/teams", "Teams"],
  ["/league-rules", "League Rules"],
  ["/draft-results", "Draft Results"],
  ["/history", "History"],
]

export default function Header() {
  return (
    <header
      style={{
        background: "#f97316",
        color: "#ffffff",
        padding: "20px 0 14px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: "rgba(255,255,255,0.18)",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
            }}
          >
            FX
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18 }}>Fantrax League Hub</h1>
            <p style={{ margin: "4px 0 0", opacity: 0.95 }}>
              Cloudflare Pages starter with season-aware routing
            </p>
          </div>
        </div>

        <SeasonSelector />
      </div>

      <nav
        style={{
          maxWidth: 1200,
          margin: "14px auto 0",
          padding: "0 20px",
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        {LINKS.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            style={({ isActive }) => ({
              textDecoration: "none",
              color: isActive ? "#f97316" : "#ffffff",
              background: isActive ? "#ffffff" : "rgba(255,255,255,0.12)",
              padding: "10px 16px",
              borderRadius: 999,
              fontWeight: 500,
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}