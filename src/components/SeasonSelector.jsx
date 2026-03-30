import { useSeason } from "../context/SeasonContext"

export default function SeasonSelector() {
  const { seasonKey, setSeasonKey, seasons } = useSeason()

  return (
    <select
      value={seasonKey}
      onChange={(e) => setSeasonKey(e.target.value)}
      style={{
        background: "rgba(255,255,255,0.18)",
        color: "#ffffff",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 999,
        padding: "10px 14px",
        fontSize: 16,
        outline: "none",
        cursor: "pointer",
      }}
    >
      {seasons.map((season) => (
        <option key={season.key} value={season.key} style={{ color: "#111827" }}>
          {season.label}
        </option>
      ))}
    </select>
  )
}