import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  buildHeadToHeadDetail,
  buildHeadToHeadSummary,
  buildPlayoffHistory,
  buildRecords,
  buildRegularHistory,
  buildTotalHistory,
  canonicalTeamName,
  formatNumber,
  formatPct,
  slugifyTeamName,
} from '../utils/history'

const HISTORY_URL = '/data/history-data.json'
const TABS = [
  { key: 'total', label: 'Total' },
  { key: 'regular', label: 'Regular Season' },
  { key: 'playoffs', label: 'Playoffs' },
  { key: 'h2h', label: 'Head-to-Head' },
  { key: 'records', label: 'Records' },
]

function TeamLink({ teamName }) {
  const clean = canonicalTeamName(teamName)
  if (!clean) return <span>—</span>
  return (
    <Link to={`/teams/${slugifyTeamName(clean)}`} style={teamLink}>
      {clean}
    </Link>
  )
}

function SortableHeader({ label, columnKey, sortConfig, onSort }) {
  const active = sortConfig.key === columnKey
  const arrow = !active ? '↕' : sortConfig.direction === 'asc' ? '▲' : '▼'

  return (
    <th style={th}>
      <button type="button" onClick={() => onSort(columnKey)} style={sortBtn}>
        <span>{label}</span>
        <span style={{ fontSize: 11 }}>{arrow}</span>
      </button>
    </th>
  )
}

function compareValues(a, b) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function sortRows(rows, sortConfig) {
  return [...rows].sort((a, b) => {
    const result = compareValues(a?.[sortConfig.key], b?.[sortConfig.key])
    return sortConfig.direction === 'asc' ? result : -result
  })
}

function HistoryLeaderboardTable({ rows, sortConfig, onSort }) {
  const sorted = useMemo(() => sortRows(rows, sortConfig), [rows, sortConfig])

  return (
    <div style={tableWrap}>
      <table style={table}>
        <thead>
          <tr style={theadRow}>
            <SortableHeader label="Team" columnKey="team" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label="First Year" columnKey="firstYear" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label="Last Year" columnKey="lastYear" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label="Matchups" columnKey="matches" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label="Games Won" columnKey="gamesWon" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label="Game Win %" columnKey="gameWinPct" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label="W" columnKey="wins" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label="L" columnKey="losses" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label="D" columnKey="ties" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label="Category Win %" columnKey="categoryWinPct" sortConfig={sortConfig} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.team}>
              <td style={td}><TeamLink teamName={row.team} /></td>
              <td style={td}>{row.firstYear}</td>
              <td style={td}>{row.lastYear}</td>
              <td style={td}>{formatNumber(row.matches)}</td>
              <td style={td}>{formatNumber(row.gamesWon, 1)}</td>
              <td style={td}>{formatPct(row.gameWinPct)}</td>
              <td style={td}>{formatNumber(row.wins)}</td>
              <td style={td}>{formatNumber(row.losses)}</td>
              <td style={td}>{formatNumber(row.ties)}</td>
              <td style={td}>{formatPct(row.categoryWinPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function HistoryPage() {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('total')
  const [selectedTeam, setSelectedTeam] = useState('')
  const [selectedOpponent, setSelectedOpponent] = useState('')
  const [leaderSort, setLeaderSort] = useState({ key: 'gameWinPct', direction: 'desc' })
  const [h2hSort, setH2hSort] = useState({ key: 'matches', direction: 'desc' })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError('')
        const res = await fetch(HISTORY_URL)
        const text = await res.text()
        if (!res.ok) throw new Error(`History data failed (${res.status}): ${text}`)
        const json = JSON.parse(text)
        if (!cancelled) {
          setPayload(json)
          setSelectedTeam((prev) => prev || json?.teams?.[0] || '')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setPayload(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const rows = payload?.rows || []
  const teams = payload?.teams || []

  const totalRows = useMemo(() => buildTotalHistory(rows), [rows])
  const regularRows = useMemo(() => buildRegularHistory(rows), [rows])
  const playoffRows = useMemo(() => buildPlayoffHistory(rows), [rows])
  const h2hRows = useMemo(() => buildHeadToHeadSummary(rows, selectedTeam), [rows, selectedTeam])
  const recordRows = useMemo(() => buildRecords(rows), [rows])
  const detailRows = useMemo(() => buildHeadToHeadDetail(rows, selectedTeam, selectedOpponent), [rows, selectedTeam, selectedOpponent])

  useEffect(() => {
    if (!selectedTeam) return
    const opponents = h2hRows.map((row) => row.opponent)
    if (!opponents.length) {
      setSelectedOpponent('')
      return
    }
    setSelectedOpponent((prev) => (prev && opponents.includes(prev) ? prev : opponents[0]))
  }, [selectedTeam, h2hRows])

  function handleLeaderSort(columnKey) {
    setLeaderSort((prev) => ({
      key: columnKey,
      direction: prev.key === columnKey && prev.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  function handleH2HSort(columnKey) {
    setH2hSort((prev) => ({
      key: columnKey,
      direction: prev.key === columnKey && prev.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const currentRows = tab === 'regular' ? regularRows : tab === 'playoffs' ? playoffRows : totalRows
  const sortedH2HRows = useMemo(() => sortRows(h2hRows, h2hSort), [h2hRows, h2hSort])

  return (
    <main style={main}>
      <section style={hero}>
        <div style={eyebrow}>History</div>
        <h1 style={heroTitle}>League History Hub</h1>
        <p style={heroSub}>
          Rebuilt from the workbook&apos;s canonical Data sheet, with team aliases normalized for franchise continuity.
        </p>
        {!loading && !error ? (
          <div style={summaryGrid}>
            <StatCard label="Rows" value={formatNumber(payload?.rowCount || 0)} />
            <StatCard label="Teams" value={formatNumber(teams.length)} />
            <StatCard label="Years" value={`${payload?.years?.[0] || '—'} - ${payload?.years?.[payload?.years?.length - 1] || '—'}`} />
          </div>
        ) : null}
      </section>

      {loading ? (
        <div style={loadingBox}>Loading history...</div>
      ) : error ? (
        <div style={errorBox}>{error}</div>
      ) : (
        <>
          <section style={section}>
            <div style={tabRow}>
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  style={tab === item.key ? activeTabBtn : tabBtn}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === 'total' || tab === 'regular' || tab === 'playoffs' ? (
              <HistoryLeaderboardTable rows={currentRows} sortConfig={leaderSort} onSort={handleLeaderSort} />
            ) : tab === 'h2h' ? (
              <>
                <div style={controlsRow}>
                  <label style={filterLabel}>
                    Team
                    <select value={selectedTeam} onChange={(e) => setSelectedTeam(e.target.value)} style={filterSelect}>
                      {teams.map((team) => (
                        <option key={team} value={team}>{team}</option>
                      ))}
                    </select>
                  </label>

                  <label style={filterLabel}>
                    Opponent
                    <select value={selectedOpponent} onChange={(e) => setSelectedOpponent(e.target.value)} style={filterSelect}>
                      {h2hRows.map((row) => (
                        <option key={row.opponent} value={row.opponent}>{row.opponent}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div style={tableWrap}>
                  <table style={table}>
                    <thead>
                      <tr style={theadRow}>
                        <SortableHeader label="Opponent" columnKey="opponent" sortConfig={h2hSort} onSort={handleH2HSort} />
                        <SortableHeader label="Matchups" columnKey="matches" sortConfig={h2hSort} onSort={handleH2HSort} />
                        <SortableHeader label="Games Won" columnKey="gamesWon" sortConfig={h2hSort} onSort={handleH2HSort} />
                        <SortableHeader label="Game Win %" columnKey="gameWinPct" sortConfig={h2hSort} onSort={handleH2HSort} />
                        <SortableHeader label="W" columnKey="wins" sortConfig={h2hSort} onSort={handleH2HSort} />
                        <SortableHeader label="L" columnKey="losses" sortConfig={h2hSort} onSort={handleH2HSort} />
                        <SortableHeader label="D" columnKey="ties" sortConfig={h2hSort} onSort={handleH2HSort} />
                        <SortableHeader label="Regular" columnKey="regularMatches" sortConfig={h2hSort} onSort={handleH2HSort} />
                        <SortableHeader label="Playoffs" columnKey="playoffMatches" sortConfig={h2hSort} onSort={handleH2HSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedH2HRows.map((row) => (
                        <tr key={row.opponent}>
                          <td style={td}><TeamLink teamName={row.opponent} /></td>
                          <td style={td}>{formatNumber(row.matches)}</td>
                          <td style={td}>{formatNumber(row.gamesWon, 1)}</td>
                          <td style={td}>{formatPct(row.gameWinPct)}</td>
                          <td style={td}>{formatNumber(row.wins)}</td>
                          <td style={td}>{formatNumber(row.losses)}</td>
                          <td style={td}>{formatNumber(row.ties)}</td>
                          <td style={td}>{formatNumber(row.regularMatches)}</td>
                          <td style={td}>{formatNumber(row.playoffMatches)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ ...section, marginBottom: 0, marginTop: 18, padding: 20 }}>
                  <h3 style={{ marginTop: 0 }}>
                    {selectedTeam || '—'} vs {selectedOpponent || '—'}
                  </h3>
                  <div style={tableWrap}>
                    <table style={table}>
                      <thead>
                        <tr style={theadRow}>
                          <th style={th}>Year</th>
                          <th style={th}>Phase</th>
                          <th style={th}>Period</th>
                          <th style={th}>Games Won</th>
                          <th style={th}>W-L-D</th>
                          <th style={th}>Manager</th>
                          <th style={th}>Opponent Manager</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailRows.map((row) => (
                          <tr key={row.rowId}>
                            <td style={td}>{row.year}</td>
                            <td style={td}>{row.phase}</td>
                            <td style={td}>{row.period}</td>
                            <td style={td}>{formatNumber(row.gamesWon, 1)}</td>
                            <td style={td}>{row.wins}-{row.losses}-{row.ties}</td>
                            <td style={td}>{row.manager || '—'}</td>
                            <td style={td}>{row.opponentManager || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div style={tableWrap}>
                <table style={table}>
                  <thead>
                    <tr style={theadRow}>
                      <th style={th}>Record</th>
                      <th style={th}>Team</th>
                      <th style={th}>Value</th>
                      <th style={th}>Year</th>
                      <th style={th}>Phase</th>
                      <th style={th}>Opponent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordRows.map((record) => (
                      <tr key={record.key}>
                        <td style={td}>{record.label}</td>
                        <td style={td}>{record.top ? <TeamLink teamName={record.top.team} /> : '—'}</td>
                        <td style={td}>{record.top ? String(record.top[record.key]) : '—'}</td>
                        <td style={td}>{record.top?.year ?? '—'}</td>
                        <td style={td}>{record.top?.phase ?? '—'}</td>
                        <td style={td}>{record.top?.opponent ? <TeamLink teamName={record.top.opponent} /> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}

function StatCard({ label, value }) {
  return (
    <div style={statCard}>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value}</div>
    </div>
  )
}

const main = {
  maxWidth: 1240,
  margin: '0 auto',
  padding: '32px 20px 48px',
}

const hero = {
  background: 'linear-gradient(135deg, #f97316 0%, #fb923c 100%)',
  color: '#ffffff',
  borderRadius: 28,
  padding: '28px 28px 30px',
  marginBottom: 24,
  boxShadow: '0 18px 40px rgba(249,115,22,0.18)',
}

const eyebrow = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  opacity: 0.95,
  marginBottom: 10,
}

const heroTitle = {
  margin: 0,
  fontSize: 'clamp(28px, 4vw, 40px)',
  lineHeight: 1.05,
}

const heroSub = {
  margin: '10px 0 18px',
  fontSize: 16,
  opacity: 0.95,
}

const section = {
  background: '#ffffff',
  border: '1px solid #fed7aa',
  borderRadius: 24,
  padding: 24,
  marginBottom: 22,
}

const loadingBox = {
  background: '#ffffff',
  border: '1px solid #fed7aa',
  borderRadius: 20,
  padding: 24,
}

const errorBox = {
  background: '#fff7ed',
  border: '1px solid #fed7aa',
  borderRadius: 20,
  padding: 24,
  color: '#9a3412',
}

const summaryGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  gap: 14,
}

const statCard = {
  background: 'rgba(255,255,255,0.14)',
  border: '1px solid rgba(255,255,255,0.22)',
  borderRadius: 18,
  padding: 16,
}

const statLabel = {
  fontSize: 13,
  fontWeight: 700,
  opacity: 0.9,
}

const statValue = {
  marginTop: 8,
  fontSize: 20,
  fontWeight: 800,
}

const tabRow = {
  display: 'flex',
  gap: 10,
  marginBottom: 18,
  flexWrap: 'wrap',
}

const tabBtn = {
  border: '1px solid #fed7aa',
  background: '#fff7ed',
  color: '#9a3412',
  borderRadius: 999,
  padding: '10px 14px',
  fontWeight: 700,
  cursor: 'pointer',
}

const activeTabBtn = {
  ...tabBtn,
  background: '#f97316',
  color: '#ffffff',
  border: '1px solid #f97316',
}

const controlsRow = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  flexWrap: 'wrap',
  marginBottom: 18,
}

const filterLabel = {
  display: 'grid',
  gap: 6,
  fontWeight: 700,
  color: '#9a3412',
}

const filterSelect = {
  minWidth: 220,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid #fed7aa',
}

const tableWrap = {
  overflowX: 'auto',
}

const table = {
  width: '100%',
  borderCollapse: 'collapse',
}

const theadRow = {
  background: '#fff7ed',
}

const th = {
  textAlign: 'left',
  padding: '14px 16px',
  borderBottom: '1px solid #fed7aa',
  color: '#9a3412',
}

const td = {
  padding: '14px 16px',
  borderBottom: '1px solid #ffedd5',
  verticalAlign: 'top',
}

const sortBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: 'none',
  background: 'transparent',
  color: '#9a3412',
  fontWeight: 700,
  cursor: 'pointer',
  padding: 0,
}

const teamLink = {
  color: '#f97316',
  fontWeight: 700,
  textDecoration: 'none',
}
