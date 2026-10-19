# export_player_dictionaries.py
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests


DEFAULT_SEASONS_FILE = Path("src/config/seasons.js")
DEFAULT_PUBLIC_DATA_DIR = Path("public/data")
DEFAULT_BASE_URL = "http://localhost:8788"


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


def s(value: Any) -> str:
    return str(value or "").strip()


def decode_maybe_broken_text(value: Any) -> str:
    text = s(value)
    if not text:
        return ""
    try:
        return text.encode("latin1").decode("utf-8")
    except Exception:
        return text


def fetch_json(base_url: str, path: str) -> Any:
    url = f"{base_url.rstrip('/')}{path}"
    resp = requests.get(url, timeout=90)
    resp.raise_for_status()
    return resp.json()


def is_probably_player_object(obj: dict[str, Any]) -> bool:
    """
    Heuristic only.
    We want player-ish objects, not team objects.
    """
    if not isinstance(obj, dict):
        return False

    player_id = obj.get("id") or obj.get("playerId")
    if not player_id:
        return False

    name = obj.get("name") or obj.get("playerName")
    if not name:
        return False

    # Strong player markers commonly seen in Fantrax/player payloads
    player_markers = [
        "short_name",
        "shortName",
        "team_name",
        "teamName",
        "team_short_name",
        "teamShortName",
        "pos_short_name",
        "pos",
        "position",
        "positions",
        "all_positions",
        "day_to_day",
        "out",
        "injured_reserve",
        "injured",
        "suspended",
        "status",
        "slot",
        "selectedPosition",
    ]

    if any(marker in obj for marker in player_markers):
        return True

    # Draft-result style candidate if it looks more player-ish than team-ish
    if "playerId" in obj and ("playerName" in obj or "name" in obj):
        return True

    return False


def normalize_player_candidate(obj: dict[str, Any]) -> dict[str, Any] | None:
    player_id = s(obj.get("id") or obj.get("playerId"))
    if not player_id:
        return None

    name = (
        obj.get("name")
        or obj.get("playerName")
        or obj.get("fullName")
        or obj.get("displayName")
        or obj.get("short_name")
        or obj.get("shortName")
    )
    name = decode_maybe_broken_text(name)
    if not name:
        return None

    short_name = decode_maybe_broken_text(obj.get("short_name") or obj.get("shortName") or "")
    team = decode_maybe_broken_text(obj.get("team_name") or obj.get("teamName") or "")
    team_short = decode_maybe_broken_text(obj.get("team_short_name") or obj.get("teamShortName") or "")
    pos = s(obj.get("pos_short_name") or obj.get("pos") or obj.get("position") or "")

    if isinstance(obj.get("positions"), list) and not pos:
        pos = "/".join(s(x) for x in obj["positions"] if x is not None)

    return {
        "name": name,
        "shortName": short_name,
        "pos": pos,
        "team": team,
        "teamShortName": team_short,
    }


def merge_player(players: dict[str, dict[str, Any]], player_id: str, incoming: dict[str, Any]) -> None:
    existing = players.get(player_id)
    if not existing:
        players[player_id] = dict(incoming)
        return

    for key in ["name", "shortName", "pos", "team", "teamShortName"]:
        if not existing.get(key) and incoming.get(key):
            existing[key] = incoming[key]


def walk_json_for_players(node: Any, players: dict[str, dict[str, Any]]) -> None:
    if isinstance(node, dict):
        if is_probably_player_object(node):
            normalized = normalize_player_candidate(node)
            if normalized:
                player_id = s(node.get("id") or node.get("playerId"))
                merge_player(players, player_id, normalized)

        for value in node.values():
            walk_json_for_players(value, players)

    elif isinstance(node, list):
        for item in node:
            walk_json_for_players(item, players)


def collect_from_team_rosters(
    base_url: str,
    season_key: str,
    players: dict[str, dict[str, Any]],
    max_period: int,
) -> None:
    found_any_period = False

    for period in range(1, max_period + 1):
        path = f"/api/team-rosters?season={season_key}&period={period}"

        try:
            data = fetch_json(base_url, path)
        except Exception as exc:
            print(f"[warn] team-rosters season={season_key} period={period} failed: {exc}", file=sys.stderr)
            continue

        before = len(players)
        walk_json_for_players(data, players)
        after = len(players)

        if after > before:
            found_any_period = True
            print(f"[info] team-rosters season={season_key} period={period}: +{after - before} players")

    if not found_any_period:
        print(f"[warn] No player objects found from team-rosters for season {season_key}", file=sys.stderr)


def collect_from_draft_results(
    base_url: str,
    season_key: str,
    players: dict[str, dict[str, Any]],
) -> None:
    path = f"/api/draft-results?season={season_key}"

    try:
        data = fetch_json(base_url, path)
    except Exception as exc:
        print(f"[warn] draft-results season={season_key} failed: {exc}", file=sys.stderr)
        return

    before = len(players)
    walk_json_for_players(data, players)
    after = len(players)

    print(f"[info] draft-results season={season_key}: +{after - before} players")


def collect_from_adp(
    base_url: str,
    players: dict[str, dict[str, Any]],
) -> None:
    """
    Optional supplement for active players only.
    Not season-specific, but useful to fill blanks.
    """
    path = "/api/adp"

    try:
        data = fetch_json(base_url, path)
    except Exception as exc:
        print(f"[warn] adp failed: {exc}", file=sys.stderr)
        return

    before = len(players)

    if isinstance(data, list):
        for row in data:
            if not isinstance(row, dict):
                continue
            player_id = s(row.get("id"))
            name = decode_maybe_broken_text(row.get("name"))
            if not player_id or not name:
                continue
            merge_player(
                players,
                player_id,
                {
                    "name": name,
                    "shortName": "",
                    "pos": s(row.get("pos")),
                    "team": "",
                    "teamShortName": "",
                },
            )

    after = len(players)
    print(f"[info] adp supplement: +{after - before} players")


def export_one_season(
    season_key: str,
    seasons_file: str | Path,
    base_url: str,
    output: str | Path | None = None,
    max_period: int = 25,
    include_adp_supplement: bool = True,
) -> Path:
    season = get_season_config(season_key, seasons_file)
    resolved_season_key = season["key"]
    league_id = season["leagueId"]

    if output is None:
        output_path = DEFAULT_PUBLIC_DATA_DIR / f"player-dictionary-{resolved_season_key}.json"
    else:
        output_path = Path(output)

    players: dict[str, dict[str, Any]] = {}

    collect_from_team_rosters(
        base_url=base_url,
        season_key=resolved_season_key,
        players=players,
        max_period=max_period,
    )

    collect_from_draft_results(
        base_url=base_url,
        season_key=resolved_season_key,
        players=players,
    )

    if include_adp_supplement:
        collect_from_adp(
            base_url=base_url,
            players=players,
        )

    players = dict(sorted(players.items(), key=lambda kv: (kv[1].get("name") or kv[0]).lower()))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(players, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\nWrote {output_path.resolve()}")
    print(f"Season: {resolved_season_key}")
    print(f"League ID: {league_id}")
    print(f"Players: {len(players)}")

    preview = list(players.items())[:5]
    if preview:
        print("\nPreview:")
        print(json.dumps(dict(preview), ensure_ascii=False, indent=2))

    return output_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season-key", default=None, help="Season key from seasons.js, e.g. 2024-25")
    parser.add_argument("--all-seasons", action="store_true", help="Export player dictionary for every season in seasons.js")
    parser.add_argument("--seasons-file", default=str(DEFAULT_SEASONS_FILE))
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Usually http://localhost:5173 while your site is running")
    parser.add_argument("--output", default=None, help="Optional explicit output path for single-season export")
    parser.add_argument("--max-period", type=int, default=25, help="How many periods to try for /api/team-rosters")
    parser.add_argument("--no-adp-supplement", action="store_true")
    args = parser.parse_args()

    seasons = load_seasons_from_js(args.seasons_file)

    if args.all_seasons:
        for season in seasons:
            export_one_season(
                season_key=season["key"],
                seasons_file=args.seasons_file,
                base_url=args.base_url,
                output=None,
                max_period=args.max_period,
                include_adp_supplement=not args.no_adp_supplement,
            )
        return 0

    requested_season_key = args.season_key
    if not requested_season_key:
        current = next((s for s in seasons if s.get("isCurrent")), None)
        requested_season_key = (current or seasons[0])["key"]

    export_one_season(
        season_key=requested_season_key,
        seasons_file=args.seasons_file,
        base_url=args.base_url,
        output=args.output,
        max_period=args.max_period,
        include_adp_supplement=not args.no_adp_supplement,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())