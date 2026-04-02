import { parsePlayerCsv } from "./fantrax"

export const CONTRACTS_SHEET_ID = "178c8EuOzomntGys9O6zKpZ2LcNokUwh1UM7XKc7PMfc"
export const CONTRACTS_GID = "570092115"
export const CONTRACTS_CSV_URL = `https://docs.google.com/spreadsheets/d/${CONTRACTS_SHEET_ID}/export?format=csv&gid=${CONTRACTS_GID}`

function s(value) {
  return String(value ?? "").trim()
}

export function normalizeContractPlayerName(value) {
  return s(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseDateParts(value) {
  const text = s(value)
  if (!text) return null

  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return null

  const month = Number(match[1])
  const day = Number(match[2])
  let year = Number(match[3])

  if (year < 100) year += 2000
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) {
    return null
  }

  return { year, month, day }
}

export function formatContractDate(value) {
  const parts = parseDateParts(value)
  if (!parts) return s(value) || "—"

  const date = new Date(parts.year, parts.month - 1, parts.day)
  if (Number.isNaN(date.getTime())) return s(value) || "—"

  return date.toLocaleDateString()
}

export function parseContractsCsv(text = "") {
  const rows = parsePlayerCsv(text)

  return rows
    .map((row, index) => {
      const player = s(row.Player)
      if (!player) return null

      const contractYear = Number(row["Contract Year"])
      const expiryYear = Number(row["EXPIRY DATE"])
      const tradeDate = s(row["TRADE DATE"])
      const age = Number(row.Age)
      const status = s(row.Status)

      return {
        id: `${normalizeContractPlayerName(player)}-${index}`,
        player,
        normalizedPlayer: normalizeContractPlayerName(player),
        status,
        age: Number.isFinite(age) ? age : null,
        contractYear: Number.isFinite(contractYear) ? contractYear : null,
        tradeDate,
        tradeDateLabel: formatContractDate(tradeDate),
        expiryYear: Number.isFinite(expiryYear) ? expiryYear : null,
        raw: row,
      }
    })
    .filter(Boolean)
}

export function buildContractsMap(contracts = []) {
  const map = new Map()

  for (const contract of contracts) {
    if (!contract?.normalizedPlayer) continue
    if (!map.has(contract.normalizedPlayer)) {
      map.set(contract.normalizedPlayer, contract)
    }
  }

  return map
}

export function enrichRosterWithContracts(rows = [], contractsMap) {
  return rows.map((row) => {
    const key = normalizeContractPlayerName(row?.playerName || "")
    const contract = contractsMap.get(key) || null

    return {
      ...row,
      contract,
      contractYear: contract?.contractYear ?? null,
      expiryYear: contract?.expiryYear ?? null,
      tradeDate: contract?.tradeDate ?? "",
      tradeDateLabel: contract?.tradeDateLabel ?? "—",
    }
  })
}