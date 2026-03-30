export default function StandingsTable({ rows = [] }) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #fed7aa",
        borderRadius: 20,
        overflow: "hidden",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#fff7ed" }}>
              <th style={th}>Rank</th>
              <th style={th}>Team</th>
              <th style={th}>Record</th>
              <th style={th}>Win %</th>
              <th style={th}>GB</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td style={td} colSpan={5}>
                  No standings found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.teamId || `${row.rank}-${row.teamName}`}>
                  <td style={td}>{row.rank ?? "—"}</td>
                  <td style={td}>{row.teamName ?? "—"}</td>
                  <td style={td}>{row.points ?? "—"}</td>
                  <td style={td}>
                    {typeof row.winPercentage === "number"
                      ? row.winPercentage.toFixed(3)
                      : row.winPercentage ?? "—"}
                  </td>
                  <td style={td}>{row.gamesBack ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const th = {
  textAlign: "left",
  padding: "14px 16px",
  borderBottom: "1px solid #fed7aa",
  color: "#9a3412",
  fontSize: 14,
}

const td = {
  padding: "14px 16px",
  borderBottom: "1px solid #ffedd5",
  fontSize: 14,
}