export const SEASONS = [
  {
    key: "2025-26",
    label: "2025-26",
    leagueId: "tl6muagkmafhimxi",
    isCurrent: true,
    spreadsheets: {},
  },
  {
    key: "2024-25",
    label: "2024-25",
    leagueId: "ux9wq6lalw7irn5t",
    spreadsheets: {},
  },
    {
    key: "2023-24",
    label: "2023-24",
    leagueId: "g2tge98klgb1r4ml",
    spreadsheets: {},
  },
    {
    key: "2022-23",
    label: "2022-23",
    leagueId: "2slnesrbl1umsts1",
    spreadsheets: {},
  },
  {
    key: "2021-22",
    label: "2021-22",
    leagueId: "mxnnnmkpkouflnx7",
    spreadsheets: {},
  },
  {
    key: "2020-21",
    label: "2020-21",
    leagueId: "mpda9aprkh7tali6",
    spreadsheets: {},
  },
]

export function getSeasonByKey(seasonKey) {
  return (
    SEASONS.find((s) => s.key === seasonKey) ||
    SEASONS.find((s) => s.isCurrent) ||
    SEASONS[0]
  )
}