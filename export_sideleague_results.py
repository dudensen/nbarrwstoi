from __future__ import annotations

import argparse
import json
import os
import pickle
import re
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


DEFAULT_SIDELEAGUES_FILE = Path("src/config/sideleagues.js")
DEFAULT_PUBLIC_DATA_DIR = Path("public/data/sideleagues")


def load_sideleagues_from_js(sideleagues_file: str | Path) -> list[dict[str, Any]]:
    path = Path(sideleagues_file)
    if not path.exists():
        raise FileNotFoundError(f"Sideleagues file not found: {path}")

    text = path.read_text(encoding="utf-8")

    match = re.search(r"export\s+const\s+SIDELEAGUES\s*=\s*\[([\s\S]*?)\]\s*export", text)
    if not match:
        match = re.search(r"export\s+const\s+SIDELEAGUES\s*=\s*\[([\s\S]*?)\]\s*$", text)

    if not match:
        raise RuntimeError(f"Could not find `export const SIDELEAGUES = [...]` in {path}")

    body = match.group(1)

    objects: list[str] = []
    depth = 0
    start = None
    in_string = False
    string_char = ""
    escape = False

    for i, ch in enumerate(body):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == string_char:
                in_string = False
            continue

        if ch in ('"', "'"):
            in_string = True
            string_char = ch
            continue

        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                objects.append(body[start:i + 1])
                start = None

    if not objects:
        raise RuntimeError(f"No sideleague objects found in {path}")

    def extract_string(obj_text: str, key: str) -> str | None:
        m = re.search(rf"{re.escape(key)}\s*:\s*(['\"])(.*?)\1", obj_text, re.S)
        return m.group(2) if m else None

    def extract_number(obj_text: str, key: str) -> int | float | None:
        m = re.search(rf"{re.escape(key)}\s*:\s*(-?\d+(?:\.\d+)?)", obj_text)
        if not m:
            return None
        raw = m.group(1)
        return float(raw) if "." in raw else int(raw)

    def extract_array_of_strings(obj_text: str, key: str) -> list[str]:
        m = re.search(rf"{re.escape(key)}\s*:\s*\[(.*?)\]", obj_text, re.S)
        if not m:
            return []
        inner = m.group(1)
        return [x[1] for x in re.findall(r"(['\"])(.*?)\1", inner, re.S)]

    def extract_bool(obj_text: str, key: str) -> bool | None:
        m = re.search(rf"{re.escape(key)}\s*:\s*(true|false)", obj_text)
        if not m:
            return None
        return m.group(1) == "true"

    sideleagues: list[dict[str, Any]] = []

    for obj in objects:
        item: dict[str, Any] = {}

        for key in ["key", "name", "seasonLabel", "leagueId", "description", "view"]:
            value = extract_string(obj, key)
            if value is not None:
                item[key] = value

        period = extract_number(obj, "period")
        if period is not None:
            item["period"] = period

        teams = extract_array_of_strings(obj, "teams")
        if teams:
            item["teams"] = teams

        enabled = extract_bool(obj, "enabled")
        if enabled is not None:
            item["enabled"] = enabled

        if item:
            sideleagues.append(item)

    if not sideleagues:
        raise RuntimeError(f"Parsed 0 sideleagues from {path}")

    return sideleagues


def get_sideleague_config(sideleague_key: str, sideleagues_file: str | Path) -> dict[str, Any]:
    sideleagues = load_sideleagues_from_js(sideleagues_file)

    selected = next((s for s in sideleagues if s.get("key") == sideleague_key), None)
    if selected:
        return selected

    if sideleagues:
        return sideleagues[0]

    raise RuntimeError(f"No sideleagues found in {sideleagues_file}")


def safe_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalize_roster_rows(roster: Any) -> list[dict[str, Any]]:
    rows_out: list[dict[str, Any]] = []

    for row in getattr(roster, "rows", []) or []:
        player = getattr(row, "player", None)
        position = getattr(row, "position", None)

        if not player:
            continue

        rows_out.append(
            {
                "id": safe_str(getattr(player, "id", "")),
                "playerName": safe_str(getattr(player, "name", "")),
                "playerPos": safe_str(
                    getattr(player, "pos_short_name", "")
                    or getattr(position, "short_name", "")
                    or getattr(position, "name", "")
                ),
            }
        )

    return rows_out


def normalize_name(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())

def export_sideleague_rosters(league: Any, sideleague: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    teams_config = sideleague.get("teams", []) or []
    if len(teams_config) < 2:
        return {}

    target_names = {normalize_name(name): name for name in teams_config}
    exported: dict[str, list[dict[str, Any]]] = {}

    for team in getattr(league, "teams", {}).values():
        team_name = safe_str(getattr(team, "name", ""))
        normalized = normalize_name(team_name)

        if normalized not in target_names:
            continue

        roster = team.roster(period_number=sideleague.get("period", 1))
        exported[normalized] = normalize_roster_rows(roster)

    return exported

def patch_fantrax_reset_info() -> None:
    """
    Patch fantraxapi.objs.league.League.reset_info so it does not crash on
    missing period/date keys like 'Oct 21'.
    """
    from fantraxapi import api
    from fantraxapi.objs.league import League
    from fantraxapi.objs.position import Position
    from fantraxapi.objs.scoring_period import ScoringPeriod
    from fantraxapi.objs.status import Status

    def safe_reset_info(self) -> None:
        responses = api.get_init_info(self)
        self.name = responses[0]["fantasySettings"]["leagueName"]
        self.year = responses[0]["fantasySettings"]["subtitle"]
        self.start_date = datetime.fromtimestamp(
            responses[0]["fantasySettings"]["season"]["startDate"] / 1e3
        )
        self.end_date = datetime.fromtimestamp(
            responses[0]["fantasySettings"]["season"]["endDate"] / 1e3
        )
        self.positions = {k: Position(self, v) for k, v in responses[0]["positionMap"].items()}
        self.status = {k: Status(self, v) for k, v in responses[1]["allObjs"].items() if "name" in v}

        period_to_day_list: dict[str, int] = {}
        for s in responses[4]["displayedLists"]["periodList"]:
            try:
                period, rest = s.split(" ", maxsplit=1)
                period_to_day_list[rest[5:-1]] = int(period)
            except Exception:
                continue

        self.scoring_dates = {}
        missing_keys = []
        for day in responses[2]["dates"]:
            scoring_date = datetime.strptime(day["object1"], "%Y-%m-%d").date()
            key = scoring_date.strftime("%b %d")
            if "0" in key and not key.endswith("0"):
                key = key.replace("0", "")

            period_number = period_to_day_list.get(key)
            if period_number is None:
                missing_keys.append(key)
                continue

            self.scoring_dates[period_number] = scoring_date

        displayed_lists = responses[3].get("displayedLists", {}) if len(responses) > 3 else {}
        scoring_period_list = displayed_lists.get("scoringPeriodList", []) or []

        self.scoring_periods = {
            p["value"]: ScoringPeriod(self, p)
            for p in scoring_period_list
            if p.get("name") != "Full Season" and p.get("value") is not None
        }
        self._scoring_periods_lookup = None

        fantasy_teams = responses[3].get("fantasyTeams", {}) if len(responses) > 3 else {}
        self._update_teams(fantasy_teams)

        if not scoring_period_list:
            print(
                "[warn] No scoringPeriodList found in init info; continuing with empty scoring periods.",
                file=sys.stderr,
            )

        if missing_keys:
            print(
                f"[warn] Skipped {len(missing_keys)} scoring date(s) missing from period map: "
                f"{', '.join(sorted(set(missing_keys))[:10])}",
                file=sys.stderr,
            )

    League.reset_info = safe_reset_info


def install_optional_login() -> None:
    username = os.getenv("FANTRAX_USERNAME")
    password = os.getenv("FANTRAX_PASSWORD")
    cookie_filepath = os.getenv("FANTRAX_COOKIE_FILE", "fantraxloggedin.cookie")

    if not username or not password:
        raise RuntimeError("Set FANTRAX_USERNAME and FANTRAX_PASSWORD when using --use-login.")

    from requests import Session
    from selenium import webdriver
    from selenium.webdriver import Keys
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions
    from selenium.webdriver.support.ui import WebDriverWait
    from webdriver_manager.chrome import ChromeDriverManager

    from fantraxapi import NotLoggedIn, api
    from fantraxapi.api import Method

    old_request = api.request

    def add_cookie_to_session(session: Session, ignore_cookie: bool = False) -> None:
        if not ignore_cookie and os.path.exists(cookie_filepath):
            with open(cookie_filepath, "rb") as f:
                for cookie in pickle.load(f):
                    session.cookies.set(cookie["name"], cookie["value"])
            return

        service = Service(ChromeDriverManager().install())
        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1600")
        options.add_argument(
            "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )

        with webdriver.Chrome(service=service, options=options) as driver:
            driver.get("https://www.fantrax.com/login")

            username_box = WebDriverWait(driver, 20).until(
                expected_conditions.presence_of_element_located((By.XPATH, "//input[@formcontrolname='email']"))
            )
            username_box.send_keys(username)

            password_box = WebDriverWait(driver, 20).until(
                expected_conditions.presence_of_element_located((By.XPATH, "//input[@formcontrolname='password']"))
            )
            password_box.send_keys(password)
            password_box.send_keys(Keys.ENTER)

            time.sleep(5)
            cookies = driver.get_cookies()
            with open(cookie_filepath, "wb") as cookie_file:
                pickle.dump(cookies, cookie_file)

            for cookie in cookies:
                session.cookies.set(cookie["name"], cookie["value"])

    def new_request(league: Any, methods: list[Method] | Method) -> dict:
        try:
            if not getattr(league, "logged_in", False):
                add_cookie_to_session(league.session)
            return old_request(league, methods)
        except NotLoggedIn:
            add_cookie_to_session(league.session, ignore_cookie=True)
            return new_request(league, methods)

    api.request = new_request


def safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        text = text.replace(",", "")
        text = text.replace("âˆ’", "-")
        return float(text)
    except Exception:
        return None


def cell_value(cells: list[dict[str, Any]], index: int, default: Any = None) -> Any:
    if index >= len(cells):
        return default
    cell = cells[index] or {}
    return cell.get("toolTip") or cell.get("content", default)

def build_header_index_map(table: dict[str, Any]) -> dict[str, int]:
    out: dict[str, int] = {}

    header_cells = ((table or {}).get("header") or {}).get("cells") or []
    for idx, cell in enumerate(header_cells):
        short_name = str(cell.get("shortName") or "").strip()
        name = str(cell.get("name") or "").strip()

        for token in [short_name, name]:
            if token and token not in out:
                out[token] = idx

    return out


def get_cell_by_header(
    cells: list[dict[str, Any]],
    header_map: dict[str, int],
    candidates: list[str],
    default: Any = None,
) -> Any:
    for candidate in candidates:
        idx = header_map.get(candidate)
        if idx is not None:
            return cell_value(cells, idx, default)

    lowered = {k.lower(): v for k, v in header_map.items()}
    for candidate in candidates:
        idx = lowered.get(candidate.lower())
        if idx is not None:
            return cell_value(cells, idx, default)

    return default

def parse_team_row(row: dict[str, Any], header_map: dict[str, int]) -> dict[str, Any]:
    fixed = (row.get("fixedCells") or [{}])[0]
    cells = row.get("cells") or []

    return {
        "matchupId": row.get("matchupId"),
        "teamId": fixed.get("teamId"),
        "teamName": fixed.get("content"),
        "leagueId": fixed.get("leagueId"),
        "disabled": bool(row.get("disabled")),
        "w": safe_float(get_cell_by_header(cells, header_map, ["W", "Category Wins"], 0)) or 0.0,
        "l": safe_float(get_cell_by_header(cells, header_map, ["L", "Category Losses"], 0)) or 0.0,
        "t": safe_float(get_cell_by_header(cells, header_map, ["T", "Category Ties"], 0)) or 0.0,
        "pts": safe_float(get_cell_by_header(cells, header_map, ["Pts", "Category points"], 0)) or 0.0,
        "stats": {
            "fgm": safe_float(get_cell_by_header(cells, header_map, ["FGM"])),
            "fgPct": safe_float(get_cell_by_header(cells, header_map, ["FG%", "Field Goal Percentage"])),
            "tpm": safe_float(get_cell_by_header(cells, header_map, ["3PTM", "3PM", "TPM"])),
            "tpPct": safe_float(get_cell_by_header(cells, header_map, ["3PT%", "3P%"])),
            "ftPct": safe_float(get_cell_by_header(cells, header_map, ["FT%", "Free Throw Percentage"])),
            "points": safe_float(get_cell_by_header(cells, header_map, ["PTS", "Points"])),
            "oreb": safe_float(get_cell_by_header(cells, header_map, ["OREB", "Offensive Rebounds"])),
            "dreb": safe_float(get_cell_by_header(cells, header_map, ["DREB", "Defensive Rebounds"])),
            "ast": safe_float(get_cell_by_header(cells, header_map, ["AST", "Assists"])),
            "st": safe_float(get_cell_by_header(cells, header_map, ["ST", "STL", "Steals"])),
            "blk": safe_float(get_cell_by_header(cells, header_map, ["BLK", "Blocks"])),
            "to": safe_float(get_cell_by_header(cells, header_map, ["TO", "Turnovers"])),
            "aTo": safe_float(get_cell_by_header(cells, header_map, ["A/TO", "A/T", "AST/TO"])),
        },
    }


def build_matchup_from_two_rows(period: int, matchup_id: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    a, b = rows[0], rows[1]

    if a["pts"] > b["pts"]:
        winner_team_id = a["teamId"]
        result = "TEAM1_WIN"
    elif b["pts"] > a["pts"]:
        winner_team_id = b["teamId"]
        result = "TEAM2_WIN"
    else:
        winner_team_id = None
        result = "TIE"

    return {
        "period": period,
        "matchupId": matchup_id,
        "teams": [
            {
                "id": a["teamId"],
                "name": a["teamName"],
                "w": a["w"],
                "l": a["l"],
                "t": a["t"],
                "pts": a["pts"],
                "disabled": a["disabled"],
                "stats": a["stats"],
            },
            {
                "id": b["teamId"],
                "name": b["teamName"],
                "w": b["w"],
                "l": b["l"],
                "t": b["t"],
                "pts": b["pts"],
                "disabled": b["disabled"],
                "stats": b["stats"],
            },
        ],
        "winnerTeamId": winner_team_id,
        "result": result,
        "scoreText": f'{a["pts"]:.2f} - {b["pts"]:.2f}',
    }


def parse_schedule_response(response: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    periods_out: list[dict[str, Any]] = []
    all_matchups: list[dict[str, Any]] = []

    table_list = response.get("tableList", [])
    for idx, table in enumerate(table_list, start=1):
        caption = table.get("caption", f"Scoring Period {idx}")
        period = idx
        if isinstance(caption, str) and caption.lower().startswith("scoring period "):
            try:
                period = int(caption.split()[-1])
            except Exception:
                pass

        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        loose_rows: list[dict[str, Any]] = []

        header_map = build_header_index_map(table)

        for row in table.get("rows", []):
            parsed = parse_team_row(row, header_map)
            matchup_id = parsed.get("matchupId")
            if matchup_id:
                grouped[matchup_id].append(parsed)
            else:
                loose_rows.append(parsed)

        period_matchups: list[dict[str, Any]] = []

        for matchup_id, grouped_rows in grouped.items():
            if len(grouped_rows) == 2:
                period_matchups.append(build_matchup_from_two_rows(period, matchup_id, grouped_rows))
            else:
                period_matchups.append(
                    {
                        "period": period,
                        "matchupId": matchup_id,
                        "teams": [
                            {
                                "id": r["teamId"],
                                "name": r["teamName"],
                                "w": r["w"],
                                "l": r["l"],
                                "t": r["t"],
                                "pts": r["pts"],
                                "disabled": r["disabled"],
                                "stats": r["stats"],
                            }
                            for r in grouped_rows
                        ],
                        "winnerTeamId": None,
                        "result": "INCOMPLETE",
                        "scoreText": None,
                    }
                )

        if loose_rows:
            for i in range(0, len(loose_rows) - 1, 2):
                a = loose_rows[i]
                b = loose_rows[i + 1]
                period_matchups.append(
                    build_matchup_from_two_rows(period, f"period{period}_fallback_{i//2 + 1}", [a, b])
                )

        period_matchups.sort(key=lambda m: (m.get("matchupId") is None, str(m.get("matchupId"))))
        periods_out.append({"period": period, "matchups": period_matchups})
        all_matchups.extend(period_matchups)

    periods_out.sort(key=lambda x: x["period"])
    all_matchups.sort(key=lambda x: (x["period"], str(x.get("matchupId"))))
    return periods_out, all_matchups


def dump_schedule_debug(response: dict[str, Any], debug_output: str | None = None) -> None:
    if not debug_output:
        return
    path = Path(debug_output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[debug] Wrote raw schedule response to {path.resolve()}")


def normalize_standings_rows(response: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Export a simple normalized standings table for sideleagues like 3pt / 3-on-3.
    """
    rows_out: list[dict[str, Any]] = []

    table_list = response.get("tableList", [])
    if not table_list:
        return rows_out

    # usually the first table is enough for standings
    table = table_list[0]
    rows = table.get("rows", [])

    for index, row in enumerate(rows, start=1):
        fixed = (row.get("fixedCells") or [{}])[0]
        cells = row.get("cells") or []

        rank = safe_float(cell_value(cells, 0))
        points = safe_float(cell_value(cells, 3))

        rows_out.append(
            {
                "rank": int(rank) if rank is not None else index,
                "teamId": fixed.get("teamId"),
                "team": fixed.get("content"),
                "leagueId": fixed.get("leagueId"),
                "points": points,
            }
        )

    rows_out.sort(key=lambda r: (r["rank"], str(r.get("team") or "")))
    return rows_out


def export_one_sideleague(
    sideleague_key: str,
    sideleagues_file: str | Path,
    output: str | Path | None = None,
    use_login: bool = False,
    debug_output: str | Path | None = None,
) -> Path:
    patch_fantrax_reset_info()

    if use_login:
        install_optional_login()

    sideleague = get_sideleague_config(sideleague_key, sideleagues_file)
    resolved_key = sideleague["key"]
    league_id = sideleague["leagueId"]
    view = sideleague.get("view") or "matchup_rosters"

    if output is None:
        output_path = DEFAULT_PUBLIC_DATA_DIR / f"{resolved_key}.json"
    else:
        output_path = Path(output)

    from fantraxapi import League, api

    league = League(league_id)

    schedule_response = api.get_standings(league, view="SCHEDULE")
    dump_schedule_debug(schedule_response, str(debug_output) if debug_output else None)
    periods, matchups = parse_schedule_response(schedule_response)

    standings_rows: list[dict[str, Any]] = []
    try:
        standings_response = api.get_standings(league)
        standings_rows = normalize_standings_rows(standings_response)
    except Exception as exc:
        print(f"[warn] Could not export standings for {resolved_key}: {exc}", file=sys.stderr)

    rosters_payload: dict[str, list[dict[str, Any]]] = {}
    if view == "matchup_rosters":
        try:
            rosters_payload = export_sideleague_rosters(league, sideleague)
        except Exception as exc:
            print(f"[warn] Could not export rosters for {resolved_key}: {exc}", file=sys.stderr)

    payload = {
        "key": resolved_key,
        "name": sideleague.get("name"),
        "seasonLabel": sideleague.get("seasonLabel"),
        "leagueId": league_id,
        "view": view,
        "teams": sideleague.get("teams", []),
        "leagueName": getattr(league, "name", None) or getattr(league, "league_name", None),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "periods": periods,
        "matchups": matchups,
        "standings": standings_rows,
        "rosters": {
            "south": rosters_payload.get("south", []),
            "north": rosters_payload.get("north", []),
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Wrote {output_path.resolve()}")
    print(f"Sideleague: {resolved_key}")
    print(f"League ID: {league_id}")
    print(f"View: {view}")
    print(f"Periods: {len(payload['periods'])}")
    print(f"Matchups: {len(payload['matchups'])}")
    print(f"Standings rows: {len(payload['standings'])}")

    preview = payload["matchups"][:3]
    if preview:
        print("\nMatchup preview:")
        print(json.dumps(preview, ensure_ascii=False, indent=2))

    if payload["standings"]:
        print("\nStandings preview:")
        print(json.dumps(payload["standings"][:5], ensure_ascii=False, indent=2))

    return output_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sideleague-key", default=None, help="Sideleague key from sideleagues.js")
    parser.add_argument("--all-sideleagues", action="store_true", help="Export all sideleagues from sideleagues.js")
    parser.add_argument("--sideleagues-file", default=str(DEFAULT_SIDELEAGUES_FILE))
    parser.add_argument("--output", default=None, help="Optional explicit output path for single-sideleague export")
    parser.add_argument("--use-login", action="store_true")
    parser.add_argument("--debug-output", default=None)
    args = parser.parse_args()

    sideleagues = load_sideleagues_from_js(args.sideleagues_file)

    if args.all_sideleagues:
        for sideleague in sideleagues:
            sideleague_key = sideleague["key"]
            debug_output = None
            if args.debug_output:
                debug_base = Path(args.debug_output)
                debug_output = debug_base.with_name(
                    f"{debug_base.stem}-{sideleague_key}{debug_base.suffix or '.json'}"
                )

            try:
                export_one_sideleague(
                    sideleague_key=sideleague_key,
                    sideleagues_file=args.sideleagues_file,
                    output=None,
                    use_login=args.use_login,
                    debug_output=debug_output,
                )
            except Exception as exc:
                print(f"[error] Failed exporting {sideleague_key}: {exc}", file=sys.stderr)
        return 0

    requested_key = args.sideleague_key
    if not requested_key:
        if not sideleagues:
            raise RuntimeError("No sideleagues found.")
        requested_key = sideleagues[0]["key"]

    export_one_sideleague(
        sideleague_key=requested_key,
        sideleagues_file=args.sideleagues_file,
        output=args.output,
        use_login=args.use_login,
        debug_output=args.debug_output,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())