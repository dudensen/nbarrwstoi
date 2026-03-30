import { onRequestGet as __api_draft_picks_js_onRequestGet } from "Y:\\nbarrwstoi\\NBAA-site\\functions\\api\\draft-picks.js"
import { onRequestGet as __api_league_info_js_onRequestGet } from "Y:\\nbarrwstoi\\NBAA-site\\functions\\api\\league-info.js"
import { onRequestGet as __api_rosters_js_onRequestGet } from "Y:\\nbarrwstoi\\NBAA-site\\functions\\api\\rosters.js"
import { onRequestGet as __api_spreadsheet_js_onRequestGet } from "Y:\\nbarrwstoi\\NBAA-site\\functions\\api\\spreadsheet.js"
import { onRequestGet as __api_standings_ts_onRequestGet } from "Y:\\nbarrwstoi\\NBAA-site\\functions\\api\\standings.ts"
import { onRequestGet as __api_test_standings_ts_onRequestGet } from "Y:\\nbarrwstoi\\NBAA-site\\functions\\api\\test-standings.ts"

export const routes = [
    {
      routePath: "/api/draft-picks",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_draft_picks_js_onRequestGet],
    },
  {
      routePath: "/api/league-info",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_league_info_js_onRequestGet],
    },
  {
      routePath: "/api/rosters",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_rosters_js_onRequestGet],
    },
  {
      routePath: "/api/spreadsheet",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_spreadsheet_js_onRequestGet],
    },
  {
      routePath: "/api/standings",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_standings_ts_onRequestGet],
    },
  {
      routePath: "/api/test-standings",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_test_standings_ts_onRequestGet],
    },
  ]