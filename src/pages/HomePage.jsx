import { useSeason } from "../context/SeasonContext"

function InfoCard({ label, value, note }) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #fed7aa",
        borderRadius: 20,
        padding: 20,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#f97316",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: "#111827",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {note ? (
        <div style={{ marginTop: 8, color: "#6b7280", fontSize: 14 }}>{note}</div>
      ) : null}
    </div>
  )
}

export default function HomePage() {
  const { season } = useSeason()

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
          Season {season.label}
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: "clamp(28px, 4vw, 40px)",
            lineHeight: 1.05,
          }}
        >
          NBArrwstoi Fantasy League
        </h1>

        <p
          style={{
            margin: "12px 0 0",
            fontSize: 16,
            opacity: 0.96,
            maxWidth: 760,
          }}
        >
          Οι NBArrwstoi είναι μια Φαντασιακή NBA Λίγκα που "τρέχει" από το 2017 μέσα από πλατφόρμες, εξελάξια, 
          facebook groups, Discord Servers, ψαγμένα internet cafe και underground μπιροκαφωδεία, σε Ελλάδα, 
          Μάλτα, Καταρ, Κύπρο, Ηνωμένο Βασίλειο, Σουηδία με μικρές στάσεις στους φίλους μας τους Αυστραλούς.
        </p>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 22,
        }}
      >
        <InfoCard label="Season" value={season.label} />
        <InfoCard label="Platform" value="Fantrax" />
        <InfoCard label="Discussions" value="Discord" />
      </section>

      <section
        style={{
          background: "#ffffff",
          border: "1px solid #fed7aa",
          borderRadius: 24,
          padding: 24,
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 24, color: "#111827" }}>
          Latest Additions
        </h2>

        <div style={{ color: "#374151", lineHeight: 1.7 }}>
          <div>• SideLeagues</div>
          <div>• Minor Bugs</div>
        </div>
      </section>
    </main>
  )
}