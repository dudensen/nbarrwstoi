# export_transactions_and_trades.py
from __future__ import annotations

import argparse
import json
import os
import pickle
import re
import sys
import time
import traceback
from datetime import date, datetime
from pathlib import Path
from typing import Any



DEFAULT_SEASONS_FILE = Path("src/config/seasons.js")
DEFAULT_PUBLIC_DATA_DIR = Path("public/data")
DEFAULT_TRANSACTION_COUNT = 5000


def load_seasons_from_js(seasons_file: str | Path) -> list[dict[str, Any]]:
    path = Path(seasons_file)
    if not path.exists():
        raise FileNotFoundError(f"Seasons file not found: {path}")

    text = path.read_text(encoding="utf-8")

    match = re.search(r"export\s+const\s+SEASONS\s*=\s*(\[[\s\S]*?\])", text)
    if not match:
        raise RuntimeError(f"Could not find `export const SEASONS = [...]` in {path}")

    array_text = match.group(1)

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
    from selenium.webdriver.common.by import By
    from selenium.webdriver.edge.options import Options
    from selenium.webdriver.edge.service import Service
    from selenium.webdriver.support import expected_conditions
    from selenium.webdriver.support.ui import WebDriverWait


    from fantraxapi import NotLoggedIn, api
    from fantraxapi.api import Method

    old_request = api.request

    def add_cookie_to_session(session: Session, ignore_cookie: bool = False) -> None:
        if not ignore_cookie and os.path.exists(cookie_filepath):
            with open(cookie_filepath, "rb") as f:
                for cookie in pickle.load(f):
                    session.cookies.set(cookie["name"], cookie["value"])
            return

        options = Options()
        options.use_chromium = True
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1600")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--remote-debugging-port=0")
        options.add_argument(
            "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )

        env_binary = os.getenv("CHROME_BINARY")
        candidate_binaries = [
            env_binary,
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ]

        resolved_binary = next((p for p in candidate_binaries if p and os.path.exists(p)), None)
        if not resolved_binary:
            raise RuntimeError(
                "Could not find an Edge browser binary. "
                "Set CHROME_BINARY to the full path of msedge.exe."
            )

        options.binary_location = resolved_binary
        print(f"[login] Using Edge binary: {resolved_binary}")

        driver_path = os.getenv("EDGE_DRIVER_PATH", r"C:\WebDriver\msedgedriver.exe")
        if not os.path.exists(driver_path):
            raise RuntimeError(
                f"EdgeDriver not found at {driver_path}. "
                "Download msedgedriver.exe and set EDGE_DRIVER_PATH if needed."
            )

        service = Service(driver_path)

        with webdriver.Edge(service=service, options=options) as driver:
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
            return

        service = Service(ChromeDriverManager().install())
        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1600")
        options.add_argument(
            "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )

        env_binary = os.getenv("CHROME_BINARY")
        candidate_binaries = [
            env_binary,
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ]

        resolved_binary = next((p for p in candidate_binaries if p and os.path.exists(p)), None)
        if not resolved_binary:
            raise RuntimeError(
                "Could not find a Chrome/Edge browser binary. "
                "Set CHROME_BINARY to the full path of msedge.exe or chrome.exe."
            )

        options.binary_location = resolved_binary
        print(f"[login] Using browser binary: {resolved_binary}")

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


def to_iso(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def safe_getattr(obj: Any, attr: str, default: Any = None) -> Any:
    try:
        return getattr(obj, attr, default)
    except Exception:
        return default


def decode_jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): decode_jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [decode_jsonable(v) for v in value]
    return to_iso(value)


def serialize_team(team: Any) -> dict[str, Any] | None:
    if team is None:
        return None

    return {
        "id": safe_getattr(team, "id"),
        "name": safe_getattr(team, "name"),
        "short": safe_getattr(team, "short", None),
    }


def serialize_position(pos: Any) -> dict[str, Any] | None:
    if pos is None:
        return None

    return {
        "id": safe_getattr(pos, "id"),
        "name": safe_getattr(pos, "name"),
        "short_name": safe_getattr(pos, "short_name"),
    }


def serialize_player(player: Any) -> dict[str, Any]:
    if player is None:
        return {}

    positions = safe_getattr(player, "positions", None) or []
    all_positions = safe_getattr(player, "all_positions", None) or []

    return {
        "id": safe_getattr(player, "id"),
        "name": safe_getattr(player, "name"),
        "short_name": safe_getattr(player, "short_name"),
        "team_name": safe_getattr(player, "team_name"),
        "team_short_name": safe_getattr(player, "team_short_name"),
        "pos_short_name": safe_getattr(player, "pos_short_name"),
        "positions": [serialize_position(p) for p in positions],
        "all_positions": [serialize_position(p) for p in all_positions],
        "day_to_day": safe_getattr(player, "day_to_day"),
        "out": safe_getattr(player, "out"),
        "injured_reserve": safe_getattr(player, "injured_reserve"),
        "suspended": safe_getattr(player, "suspended"),
        "injured": safe_getattr(player, "injured"),
    }


def serialize_transaction_player(tp: Any) -> dict[str, Any]:
    positions = safe_getattr(tp, "positions", None) or []
    all_positions = safe_getattr(tp, "all_positions", None) or []

    return {
        "id": safe_getattr(tp, "id"),
        "name": safe_getattr(tp, "name"),
        "short_name": safe_getattr(tp, "short_name"),
        "team_name": safe_getattr(tp, "team_name"),
        "team_short_name": safe_getattr(tp, "team_short_name"),
        "pos_short_name": safe_getattr(tp, "pos_short_name"),
        "positions": [serialize_position(p) for p in positions],
        "all_positions": [serialize_position(p) for p in all_positions],
        "day_to_day": safe_getattr(tp, "day_to_day"),
        "out": safe_getattr(tp, "out"),
        "injured_reserve": safe_getattr(tp, "injured_reserve"),
        "suspended": safe_getattr(tp, "suspended"),
        "injured": safe_getattr(tp, "injured"),
        "type": safe_getattr(tp, "type"),
    }


def serialize_trade_move(move: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "kind": move.__class__.__name__,
    }

    from_team = safe_getattr(move, "from_team")
    to_team = safe_getattr(move, "to_team")

    if from_team is not None:
        data["from_team"] = serialize_team(from_team)
    if to_team is not None:
        data["to_team"] = serialize_team(to_team)

    player = safe_getattr(move, "player")
    if player is not None:
        data["player"] = serialize_player(player)
        data["fantasy_points_per_game"] = safe_getattr(move, "fantasy_points_per_game")
        data["total_fantasy_points"] = safe_getattr(move, "total_fantasy_points")

    for attr in [
        "season",
        "round",
        "round_number",
        "pick",
        "overall",
        "description",
    ]:
        value = safe_getattr(move, attr, None)
        if value is not None:
            data[attr] = value

    return decode_jsonable(data)


def serialize_transaction(tx: Any) -> dict[str, Any]:
    players = safe_getattr(tx, "players", None) or []

    types = []
    for p in players:
        t = safe_getattr(p, "type", None)
        if t is not None:
            types.append(str(t))

    unique_types = list(dict.fromkeys(types))
    normalized_types = [t.lower() for t in unique_types]

    return {
        "id": safe_getattr(tx, "id"),
        "date": to_iso(safe_getattr(tx, "date")),
        "team": serialize_team(safe_getattr(tx, "team")),
        "types": unique_types,
        "is_trade_like": any("trade" in t for t in normalized_types),
        "players": [serialize_transaction_player(p) for p in players],
    }


def serialize_trade(trade: Any) -> dict[str, Any]:
    moves = safe_getattr(trade, "moves", None) or []

    return {
        "proposed_by": serialize_team(safe_getattr(trade, "proposed_by")),
        "proposed": to_iso(safe_getattr(trade, "proposed")),
        "accepted": to_iso(safe_getattr(trade, "accepted")),
        "executed": to_iso(safe_getattr(trade, "executed")),
        "moves": [serialize_trade_move(m) for m in moves],
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def export_one_season(
    season_key: str,
    seasons_file: str | Path,
    output_dir: str | Path | None = None,
    transaction_count: int = DEFAULT_TRANSACTION_COUNT,
    use_login: bool = False,
) -> tuple[Path, Path]:
    patch_fantrax_reset_info()

    if use_login:
        install_optional_login()

    season = get_season_config(season_key, seasons_file)
    resolved_season_key = season["key"]
    league_id = season["leagueId"]

    output_root = Path(output_dir) if output_dir else DEFAULT_PUBLIC_DATA_DIR
    transactions_file = output_root / f"transactions-{resolved_season_key}.json"
    trades_file = output_root / f"trades-{resolved_season_key}.json"

    from fantraxapi import League

    league = League(league_id)

    print(f"\n=== {resolved_season_key} | leagueId={league_id} ===")
    print(f"League: {getattr(league, 'name', '')} | Year: {getattr(league, 'year', '')}")

    transactions = league.transactions(count=transaction_count)
    tx_payload = [serialize_transaction(tx) for tx in transactions]
    trade_like_transactions = [tx for tx in tx_payload if tx.get("is_trade_like")]

    pending_trades_error = None
    pending_trade_payload: list[dict[str, Any]] = []

    try:
        pending_trades = league.pending_trades()
        pending_trade_payload = [serialize_trade(t) for t in pending_trades]
    except Exception as exc:
        pending_trades_error = f"{exc.__class__.__name__}: {exc}"

    base_meta = {
        "season": resolved_season_key,
        "label": season.get("label", resolved_season_key),
        "league_id": league_id,
        "league_name": getattr(league, "name", None),
        "league_year": getattr(league, "year", None),
        "exported_at": datetime.now().isoformat(),
    }

    write_json(
        transactions_file,
        {
            **base_meta,
            "count_requested": transaction_count,
            "count_returned": len(tx_payload),
            "transactions": tx_payload,
            "trade_like_transactions": trade_like_transactions,
        },
    )

    write_json(
        trades_file,
        {
            **base_meta,
            "note": (
                "fantraxapi exposes pending_trades(); this file contains pending trades only. "
                "Use trade_like_transactions from transactions-<season>.json for completed/history-like trade rows."
            ),
            "pending_trades_error": pending_trades_error,
            "count_returned": len(pending_trade_payload),
            "pending_trades": pending_trade_payload,
        },
    )

    print(f"Wrote {transactions_file.resolve()} ({len(tx_payload)} transactions)")
    print(f"Wrote {trades_file.resolve()} ({len(pending_trade_payload)} pending trades)")
    if pending_trades_error:
        print(f"[warn] Pending trades export issue: {pending_trades_error}")

    return transactions_file, trades_file


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season-key", default=None, help="Season key from seasons.js, e.g. 2025-26")
    parser.add_argument("--all-seasons", action="store_true", help="Export transactions/trades for every season in seasons.js")
    parser.add_argument("--seasons-file", default=str(DEFAULT_SEASONS_FILE))
    parser.add_argument("--output-dir", default=str(DEFAULT_PUBLIC_DATA_DIR))
    parser.add_argument("--transaction-count", type=int, default=DEFAULT_TRANSACTION_COUNT)
    parser.add_argument("--use-login", action="store_true", help="Use Fantrax browser login + saved cookie for pending trades")
    args = parser.parse_args()

    try:
        seasons = load_seasons_from_js(args.seasons_file)

        if args.all_seasons:
            failures: list[tuple[str, str]] = []

            for season in seasons:
                season_key = season["key"]
                try:
                    export_one_season(
                        season_key=season_key,
                        seasons_file=args.seasons_file,
                        output_dir=args.output_dir,
                        transaction_count=args.transaction_count,
                        use_login=args.use_login,
                    )
                except Exception as exc:
                    failures.append((season_key, f"{exc.__class__.__name__}: {exc}"))
                    print(f"FAILED {season_key}: {exc}")
                    traceback.print_exc()

            if failures:
                print("\nSome seasons failed:")
                for season_key, msg in failures:
                    print(f"  - {season_key}: {msg}")
                return 1

            return 0

        requested_season_key = args.season_key
        if not requested_season_key:
            current = next((s for s in seasons if s.get("isCurrent")), None)
            requested_season_key = (current or seasons[0])["key"]

        export_one_season(
            season_key=requested_season_key,
            seasons_file=args.seasons_file,
            output_dir=args.output_dir,
            transaction_count=args.transaction_count,
            use_login=args.use_login,
        )
        return 0

    except Exception as exc:
        print(f"Fatal error: {exc}")
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())