import { createContext, useContext, useState } from "react"
import { SEASONS } from "../config/seasons"

const SeasonContext = createContext(null)

export function SeasonProvider({ children }) {
  const defaultSeason = SEASONS.find((s) => s.isCurrent) || SEASONS[0]
  const [seasonKey, setSeasonKey] = useState(defaultSeason.key)

  const season =
    SEASONS.find((s) => s.key === seasonKey) || defaultSeason

  return (
    <SeasonContext.Provider
      value={{
        seasons: SEASONS,
        seasonKey,
        setSeasonKey,
        season,
      }}
    >
      {children}
    </SeasonContext.Provider>
  )
}

export function useSeason() {
  const ctx = useContext(SeasonContext)
  if (!ctx) {
    throw new Error("useSeason must be used inside SeasonProvider")
  }
  return ctx
}