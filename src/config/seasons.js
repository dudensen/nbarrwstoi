export const SEASONS = [
  {
    key: "2025-26",
    label: "2025-26",
    leagueId: "tl6muagkmafhimxi",
    isCurrent: true,
    dataSource: "fantrax",
    spreadsheets: {
      futurePicksSheetId: "178c8EuOzomntGys9O6zKpZ2LcNokUwh1UM7XKc7PMfc",
      futurePicksGid: "760894881",
    },
  },
  {
    key: "2024-25",
    label: "2024-25",
    leagueId: "ux9wq6lalw7irn5t",
    dataSource: "fantrax",
    spreadsheets: {},
  },
  {
    key: "2023-24",
    label: "2023-24",
    leagueId: "g2tge98klgb1r4ml",
    dataSource: "fantrax",
    spreadsheets: {},
  },
  {
    key: "2022-23",
    label: "2022-23",
    leagueId: "2slnesrbl1umsts1",
    dataSource: "fantrax",
    spreadsheets: {},
  },
  {
    key: "2021-22",
    label: "2021-22",
    leagueId: "mxnnnmkpkouflnx7",
    dataSource: "fantrax",
    spreadsheets: {},
  },
  {
    key: "2020-21",
    label: "2020-21",
    leagueId: "mpda9aprkh7tali6",
    dataSource: "fantrax",
    spreadsheets: {},
  },
  {
    key: "2019-20",
    label: "2019-20",
    leagueId: "",
    dataSource: "history",
    spreadsheets: {},
  },
  {
    key: "2018-19",
    label: "2018-19",
    leagueId: "",
    dataSource: "history",
    spreadsheets: {},
  },
  {
    key: "2017-18",
    label: "2017-18",
    leagueId: "",
    dataSource: "history",
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