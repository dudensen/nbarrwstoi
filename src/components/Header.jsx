import { NavLink } from "react-router-dom"
import SeasonSelector from "./SeasonSelector"

const LINKS = [
  ["/", "Home"],
  ["/standings", "Standings"],
  ["/teams", "Teams"],
  ["/league-rules", "League Rules"],
  ["/draft-results", "Draft Results"],
  ["/history", "History"],
  ["/contracts", "Contracts"],
  ["/war-room", "The War Room"],
]

export default function Header() {
  return (
    <header
      style={{
        background: "#f97316",
        color: "#ffffff",
        padding: "18px 0 14px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <img
          src="/fx-logo.webp"
          alt="NBArrwstoi Fantasy League logo"
          style={{
            width: 105,
            height: 105,
            objectFit: "contain",
            borderRadius: 16,
            background: "rgba(255,255,255,0.18)",
            padding: 8,
            boxSizing: "border-box",
            flexShrink: 0,
          }}
        />

        <div style={{ flex: "1 1 700px", minWidth: 280 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 14,
            }}
          >
            <div>
              <h1 style={{ margin: 0, fontSize: 18 }}>NBArrwstoi Fantasy League</h1>
              <p style={{ margin: "4px 0 0", opacity: 0.95 }}>
                Live Fantrax data, historical records, team pages, and draft history
              </p>
            </div>

            <SeasonSelector />
          </div>

          <nav
            style={{
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
        </div>
      </div>
    </header>
  )
}