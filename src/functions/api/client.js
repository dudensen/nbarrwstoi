// src/api/client.js
export async function fetchStandings(seasonKey) {
  const res = await fetch(`/api/standings?season=${encodeURIComponent(seasonKey)}`)
  if (!res.ok) throw new Error("Failed to fetch standings")
  return res.json()
}