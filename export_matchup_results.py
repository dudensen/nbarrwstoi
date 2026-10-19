# export_matchup_results.py
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


DEFAULT_SEASONS_FILE = Path("src/config/seasons.js")
DEFAULT_PUBLIC_DATA_DIR = Path("public/data")


def load_seasons_from_js(seasons_file: str | Path) -> list[dict[str, Any]]:
    path = Path(seasons_file)
    if not path.exists():
        raise FileNotFoundError(f"Seasons file not found: {path}")

    text = path.read_text(encoding="utf-8")

    match = re.search(r"export\s+const\s+SEASONS\s*=\s*(\[[\s\S]*?\])", text)
    if not match:
        raise RuntimeError(f"Could not find `export const SEASONS = [...]` in {path}")

    array_text = match.group(1)

    # Convert the JS object array into JSON safely for this known file shape.
    json_like = re.sub(r"(\b[a-zA-Z_][a-zA-Z0-9_]*\b)\s*:", r'"\1":', array_text)
    json_like = re.sub(r",(\s*[}\]])", r"\1", json_like)

    try:
        seasons = json.loads(json_like)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Could not parse seasons from {path}: {exc}") from exc

    if not isinstance(seasons, list):
        raise RuntimeError(f"`SEASONS` in {path} is not a list")

    return seasons


def get_season_config(season_key: str, seasons_file: str | Path) -> dict[str, Any]:
    seasons = load_seasons_from_js(seasons_file)

    selected = next((s for s in seasons if s.get("key") == season_key), None)
    if selected:
        return selected

    current = next((s for s in seasons if s.get("isCurrent")), None)
    if current:
        return current

    if seasons:
        return seasons[0]

    raise RuntimeError(f"No seasons found in {seasons_file}")


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

        self.scoring_periods = {
            p["value"]: ScoringPeriod(self, p)
            for p in responses[3]["displayedLists"]["scoringPeriodList"]
            if p["name"] != "Full Season"
        }
        self._scoring_periods_lookup = None
        self._update_teams(responses[3]["fantasyTeams"])

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
    if value is None:
        return None
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def cell_value(cells: list[dict[str, Any]], index: int, default: Any = None) -> Any:
    if index >= len(cells):
        return default
    cell = cells[index] or {}
    return cell.get("toolTip") or cell.get("content", default)


def parse_team_row(row: dict[str, Any]) -> dict[str, Any]:
    fixed = (row.get("fixedCells") or [{}])[0]
    cells = row.get("cells") or []

    return {
        "matchupId": row.get("matchupId"),
        "teamId": fixed.get("teamId"),
        "teamName": fixed.get("content"),
        "leagueId": fixed.get("leagueId"),
        "disabled": bool(row.get("disabled")),
        "w": safe_float(cell_value(cells, 0, 0)) or 0.0,
        "l": safe_float(cell_value(cells, 1, 0)) or 0.0,
        "t": safe_float(cell_value(cells, 2, 0)) or 0.0,
        "pts": safe_float(cell_value(cells, 3, 0)) or 0.0,
        "stats": {
            "fgm": safe_float(cell_value(cells, 4)),
            "fgPct": safe_float(cell_value(cells, 5)),
            "tpm": safe_float(cell_value(cells, 6)),
            "tpPct": safe_float(cell_value(cells, 7)),
            "ftPct": safe_float(cell_value(cells, 8)),
            "points": safe_float(cell_value(cells, 9)),
            "oreb": safe_float(cell_value(cells, 10)),
            "dreb": safe_float(cell_value(cells, 11)),
            "ast": safe_float(cell_value(cells, 12)),
            "st": safe_float(cell_value(cells, 13)),
            "blk": safe_float(cell_value(cells, 14)),
            "to": safe_float(cell_value(cells, 15)),
            "aTo": safe_float(cell_value(cells, 16)),
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

        for row in table.get("rows", []):
            parsed = parse_team_row(row)
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


def export_one_season(
    season_key: str,
    seasons_file: str | Path,
    output: str | Path | None = None,
    use_login: bool = False,
    debug_output: str | Path | None = None,
) -> Path:
    patch_fantrax_reset_info()

    if use_login:
        install_optional_login()

    season = get_season_config(season_key, seasons_file)
    resolved_season_key = season["key"]
    league_id = season["leagueId"]

    if output is None:
        output_path = DEFAULT_PUBLIC_DATA_DIR / f"matchup-results-{resolved_season_key}.json"
    else:
        output_path = Path(output)

    from fantraxapi import League, api

    league = League(league_id)
    response = api.get_standings(league, view="SCHEDULE")

    dump_schedule_debug(response, str(debug_output) if debug_output else None)

    periods, matchups = parse_schedule_response(response)

    payload = {
        "season": resolved_season_key,
        "leagueId": league_id,
        "leagueName": getattr(league, "name", None) or getattr(league, "league_name", None),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "periods": periods,
        "matchups": matchups,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Wrote {output_path.resolve()}")
    print(f"Season: {resolved_season_key}")
    print(f"League ID: {league_id}")
    print(f"Periods: {len(payload['periods'])}")
    print(f"Matchups: {len(payload['matchups'])}")

    preview = payload["matchups"][:3]
    if preview:
        print("\nPreview:")
        print(json.dumps(preview, ensure_ascii=False, indent=2))

    return output_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season-key", default=None, help="Season key from seasons.js, e.g. 2024-25")
    parser.add_argument("--all-seasons", action="store_true", help="Export matchup results for every season in seasons.js")
    parser.add_argument("--seasons-file", default=str(DEFAULT_SEASONS_FILE))
    parser.add_argument("--output", default=None, help="Optional explicit output path for single-season export")
    parser.add_argument("--use-login", action="store_true")
    parser.add_argument("--debug-output", default=None)
    args = parser.parse_args()

    seasons = load_seasons_from_js(args.seasons_file)

    if args.all_seasons:
        for season in seasons:
            season_key = season["key"]
            debug_output = None
            if args.debug_output:
                debug_base = Path(args.debug_output)
                debug_output = debug_base.with_name(f"{debug_base.stem}-{season_key}{debug_base.suffix or '.json'}")

            export_one_season(
                season_key=season_key,
                seasons_file=args.seasons_file,
                output=None,
                use_login=args.use_login,
                debug_output=debug_output,
            )
        return 0

    requested_season_key = args.season_key
    if not requested_season_key:
        current = next((s for s in seasons if s.get("isCurrent")), None)
        requested_season_key = (current or seasons[0])["key"]

    export_one_season(
        season_key=requested_season_key,
        seasons_file=args.seasons_file,
        output=args.output,
        use_login=args.use_login,
        debug_output=args.debug_output,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())