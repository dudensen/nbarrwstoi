import { useEffect, useState } from "react"

function StatusBadge({ ok }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: 999,
        fontSize: 18,
        fontWeight: 900,
        color: "#fff",
        background: ok ? "#15803d" : "#b91c1c",
        boxShadow: ok
          ? "0 8px 18px rgba(21,128,61,0.22)"
          : "0 8px 18px rgba(185,28,28,0.22)",
      }}
      aria-label={ok ? "API healthy" : "API failing"}
      title={ok ? "Healthy" : "Failing"}
    >
      {ok ? "✓" : "✕"}
    </span>
  )
}

function formatCheckedAt(value) {
  if (!value) return "—"
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString()
}

export default function ApiStatusPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  async function loadStatus() {
    try {
      setLoading(true)
      setError("")

      const res = await fetch("/api/api-status", { cache: "no-store" })
      const text = await res.text()

      if (!res.ok) {
        throw new Error(`API status failed (${res.status}): ${text}`)
      }

      const json = JSON.parse(text)
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const checks = Array.isArray(data?.checks) ? data.checks : []
  const allOk = checks.length > 0 && checks.every((item) => item.ok)

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #fed7aa",
          borderRadius: 24,
          padding: 24,
          marginBottom: 20,
          boxShadow: "0 14px 34px rgba(17, 24, 39, 0.08)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#fff7ed",
            color: "#ea580c",
            border: "1px solid #fed7aa",
            padding: "8px 12px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 800,
            marginBottom: 14,
          }}
        >
          Secret Page
        </div>

        <h1 style={{ margin: "0 0 10px", fontSize: "clamp(28px, 4vw, 40px)" }}>
          Fantrax API Status
        </h1>

        <p style={{ margin: 0, color: "#6b7280", lineHeight: 1.6 }}>
          Checks whether key Fantrax endpoints return a valid, non-empty response.
          Empty arrays like <code>[]</code> count as a failure.
        </p>
      </div>

      {error ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #fecaca",
            borderRadius: 20,
            padding: 20,
            color: "#991b1b",
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #fed7aa",
            borderRadius: 20,
            padding: 20,
          }}
        >
          <div style={{ color: "#f97316", fontWeight: 800, fontSize: 13, textTransform: "uppercase" }}>
            Overall
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
            <StatusBadge ok={allOk} />
            <div style={{ fontSize: 24, fontWeight: 800 }}>
              {loading ? "Checking..." : allOk ? "Healthy" : "Issues found"}
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #fed7aa",
            borderRadius: 20,
            padding: 20,
          }}
        >
          <div style={{ color: "#f97316", fontWeight: 800, fontSize: 13, textTransform: "uppercase" }}>
            Checked at
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 10 }}>
            {loading ? "…" : formatCheckedAt(data?.checkedAt)}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "#ffffff",
          border: "1px solid #fed7aa",
          borderRadius: 24,
          padding: 20,
          boxShadow: "0 14px 34px rgba(17, 24, 39, 0.08)",
        }}
      >
        <h2 style={{ margin: "0 0 16px" }}>Endpoint Checks</h2>

        {loading ? (
          <div style={{ color: "#6b7280" }}>Checking Fantrax endpoints...</div>
        ) : !checks.length ? (
          <div style={{ color: "#6b7280" }}>No checks returned.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {checks.map((item) => (
              <div
                key={item.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "40px 1.2fr 1fr auto",
                  gap: 14,
                  alignItems: "center",
                  padding: 16,
                  borderRadius: 18,
                  border: "1px solid #fed7aa",
                  background: item.ok ? "#fffbf7" : "#fff7f7",
                }}
              >
                <StatusBadge ok={item.ok} />

                <div>
                  <div style={{ fontWeight: 800, color: "#111827" }}>{item.label}</div>
                  <div style={{ color: "#6b7280", fontSize: 14, marginTop: 4 }}>
                    {item.url}
                  </div>
                </div>

                <div style={{ color: item.ok ? "#166534" : "#991b1b", fontWeight: 700 }}>
                  {item.message || (item.ok ? "OK" : "Failed")}
                </div>

                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#6b7280",
                    background: "#fff",
                    border: "1px solid #fed7aa",
                    padding: "8px 10px",
                    borderRadius: 999,
                  }}
                >
                  HTTP {item.status ?? "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}