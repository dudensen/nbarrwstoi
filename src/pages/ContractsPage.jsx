import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useSeason } from "../context/SeasonContext"
import {
  CONTRACTS_CSV_URL,
  normalizeContractPlayerName,
  parseContractsCsv,
} from "../utils/contracts"

import {
  buildPlayerLookupFromAdp,
  buildPlayerLookupFromCsvRows,
  mergePlayerLookups,
  parsePlayerCsv,
  slugifyTeamName,
  decodeMaybeBrokenText,
  cleanFantraxPlayerId,
} from "../utils/fantrax"

import { SEASONS } from "../config/seasons"

const CURRENT_SEASON =
  SEASONS.find((s) => s.isCurrent) ||
  SEASONS[0]

const playerCsvFiles = import.meta.glob("../config/playerCsv/*.csv", {
  query: "?raw",
  import: "default",
})

function slugifyPlayerName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function getPlayerNameFromAnyRow(row) {
  return decodeMaybeBrokenText(
    row?.name ||
      row?.playerName ||
      row?.fullName ||
      row?.Player ||
      row?.player?.name ||
      [row?.firstName, row?.lastName].filter(Boolean).join(" ") ||
      [row?.first_name, row?.last_name].filter(Boolean).join(" ") ||
      ""
  )
}

function findPlayerIdForContract(contract, playerLookup, adpRows, playerCsvRows) {
  const targetSlug = slugifyPlayerName(contract.player)

  for (const player of playerLookup.values()) {
    if (slugifyPlayerName(player?.name) === targetSlug) {
      return cleanFantraxPlayerId(player.id)
    }
  }

  const adpMatch = adpRows.find(
    (row) => slugifyPlayerName(getPlayerNameFromAnyRow(row)) === targetSlug
  )
  if (adpMatch?.id) return cleanFantraxPlayerId(adpMatch.id)

  const csvMatch = playerCsvRows.find(
    (row) => slugifyPlayerName(getPlayerNameFromAnyRow(row)) === targetSlug
  )
  if (csvMatch?.ID) return cleanFantraxPlayerId(csvMatch.ID)

  return ""
}

function compareValues(a, b) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

function SortableHeader({ label, columnKey, sortConfig, onSort }) {
  const active = sortConfig.key === columnKey
  const arrow = !active ? "↕" : sortConfig.direction === "asc" ? "▲" : "▼"

  return (
    <th style={th}>
      <button type="button" onClick={() => onSort(columnKey)} style={sortBtn}>
        <span>{label}</span>
        <span style={{ fontSize: 11 }}>{arrow}</span>
      </button>
    </th>
  )
}

export default function ContractsPage() {
  const { season } = useSeason()
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [teamFilter, setTeamFilter] = useState("all")
  const [sortConfig, setSortConfig] = useState({ key: "contractYear", direction: "desc" })
  const [playerCsvRows, setPlayerCsvRows] = useState([])
  const [adpRows, setAdpRows] = useState([])
  const [teamRosters, setTeamRosters] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError("")

        const csvLoader = playerCsvFiles[`../config/playerCsv/${season.key}.csv`]

        const [contractsRes, adpRes, rostersRes, csvText] = await Promise.all([
          fetch(CONTRACTS_CSV_URL),
          fetch(`/api/adp`),
          fetch(`/api/team-rosters?season=${encodeURIComponent(CURRENT_SEASON.key)}&period=1`),
          csvLoader ? csvLoader() : Promise.resolve(""),
        ])

        const [contractsText, adpText, rostersText] = await Promise.all([
          contractsRes.text(),
          adpRes.text(),
          rostersRes.text(),
        ])

        if (!contractsRes.ok) throw new Error(`Contracts sheet failed (${contractsRes.status}).`)
        if (!adpRes.ok) throw new Error(`ADP failed (${adpRes.status}): ${adpText}`)
        if (!rostersRes.ok) throw new Error(`Team rosters failed (${rostersRes.status}): ${rostersText}`)

        if (!cancelled) {
          setContracts(parseContractsCsv(contractsText))
          setPlayerCsvRows(parsePlayerCsv(csvText || ""))
          setAdpRows(JSON.parse(adpText))
          setTeamRosters(JSON.parse(rostersText))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error")
          setContracts([])
          setPlayerCsvRows([])
          setAdpRows([])
          setTeamRosters(null)
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

  const playerLookup = useMemo(() => {
  const csvLookup = buildPlayerLookupFromCsvRows(playerCsvRows)
  const adpLookup = buildPlayerLookupFromAdp(adpRows)
  return mergePlayerLookups(csvLookup, adpLookup)
}, [playerCsvRows, adpRows])


const rows = useMemo(() => {
  return contracts.map((contract) => ({
    ...contract,
    teamName: contract.status || "—",
    teamId: "",
  }))
}, [contracts])

  const teams = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.teamName))).sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { sensitivity: "base" })
    )
  }, [rows])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()

    const filtered = rows.filter((row) => {
      const matchesSearch =
        !query ||
        row.player.toLowerCase().includes(query) ||
        row.teamName.toLowerCase().includes(query) ||
        String(row.status || "").toLowerCase().includes(query)

      const matchesTeam = teamFilter === "all" || row.teamName === teamFilter
      return matchesSearch && matchesTeam
    })

    return [...filtered].sort((a, b) => {
      const result = compareValues(a?.[sortConfig.key], b?.[sortConfig.key])
      return sortConfig.direction === "asc" ? result : -result
    })
  }, [rows, search, teamFilter, sortConfig])

  function handleSort(columnKey) {
    setSortConfig((prev) => ({
      key: columnKey,
      direction: prev.key === columnKey && prev.direction === "asc" ? "desc" : "asc",
    }))
  }

  return (
    <main style={main}>
      <div style={hero}>
        <div style={eyebrow}>Player Contracts</div>
        <h1 style={{ margin: 0 }}>Contracts board</h1>
        <p style={heroSub}>Live from the Google Sheet. Team/status is shown directly from column B.</p>
      </div>

      <div style={card}>
        <div style={filtersRow}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player, team, or status"
            style={input}
          />

          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={select}>
            <option value="all">All teams</option>
            {teams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={card}>Loading contracts...</div>
      ) : error ? (
        <div style={errorBox}>{error}</div>
      ) : (
        <div style={card}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fff7ed" }}>
                  <SortableHeader label="Player" columnKey="player" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Team" columnKey="teamName" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Age" columnKey="age" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Contract Year" columnKey="contractYear" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Expiry" columnKey="expiryYear" sortConfig={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Trade Date" columnKey="tradeDate" sortConfig={sortConfig} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td style={td}>
                      <Link to={`/players/${slugifyPlayerName(row.player)}`} style={playerLink}>
                        {row.player}
                      </Link>
                    </td>
                    <td style={td}>
                      {row.teamId ? (
                        <Link to={`/teams/${slugifyTeamName(row.teamName)}`} style={teamLink}>
                          {row.teamName}
                        </Link>
                      ) : (
                        row.teamName
                      )}
                    </td>
                    <td style={td}>{row.age ?? "—"}</td>
                    <td style={td}>{row.contractYear ?? "—"}</td>
                    <td style={td}>{row.expiryYear ?? "—"}</td>
                    <td style={td}>{row.tradeDateLabel || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  )
}

function InfoCard({ label, value, note }) {
  return (
    <div style={statCard}>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value}</div>
      {note ? <div style={statNote}>{note}</div> : null}
    </div>
  )
}

const main = { maxWidth: 1240, margin: "0 auto", padding: "32px 20px 48px" }
const hero = {
  background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)",
  color: "#fff",
  borderRadius: 28,
  padding: "28px 28px 30px",
  marginBottom: 24,
}
const eyebrow = { fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }
const heroSub = { margin: "10px 0 0", fontSize: 16, opacity: 0.95 }
const card = { background: "#fff", border: "1px solid #fed7aa", borderRadius: 24, padding: 24, marginBottom: 22 }
const errorBox = { ...card, color: "#9a3412", background: "#fff7ed" }
const filtersRow = { display: "flex", gap: 12, flexWrap: "wrap" }
const input = { flex: "1 1 320px", padding: "12px 14px", borderRadius: 14, border: "1px solid #fdba74" }
const select = { minWidth: 220, padding: "12px 14px", borderRadius: 14, border: "1px solid #fdba74" }
const th = { textAlign: "left", padding: "12px 14px", borderBottom: "1px solid #fed7aa" }
const td = { padding: "12px 14px", borderBottom: "1px solid #ffedd5", color: "#111827" }
const sortBtn = { background: "transparent", border: 0, padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: "#9a3412" }
const playerLink = { color: "#111827", fontWeight: 700, textDecoration: "none" }
const teamLink = { color: "#f97316", fontWeight: 700, textDecoration: "none" }
const statCard = { background: "#fff", border: "1px solid #fed7aa", borderRadius: 20, padding: 20 }
const statLabel = { fontSize: 13, fontWeight: 700, color: "#f97316", textTransform: "uppercase", marginBottom: 8 }
const statValue = { fontSize: 24, fontWeight: 800, color: "#111827" }
const statNote = { marginTop: 8, color: "#6b7280", fontSize: 14 }