import json
import math
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from collections import namedtuple

from flask import Flask, render_template, request, jsonify

# pandas is intentionally NOT imported at module level. It is only needed to
# (re)build the SQLite cache from the source CSVs, and lives behind a lazy
# import inside `_build_sqlite`. After the cache exists, every warm boot reads
# from SQLite via the stdlib only — pandas is never loaded into the worker,
# saving ~27 MB of resident module code.

app = Flask(__name__)

# ── Configuration ──
CSV_DIR = os.environ.get('DATA_DIR', os.path.join(os.path.dirname(__file__), 'data'))
DB_PATH = os.path.join(CSV_DIR, 'app.db')
CSV_FILES = [
    '2025_LoL_esports_match_data_from_OraclesElixir.csv',
    '2026_LoL_esports_match_data_from_OraclesElixir.csv',
]

DETAIL_COLS = [
    'gameid', 'league', 'date', 'patch', 'participantid', 'side', 'position',
    'playername', 'teamname', 'champion', 'gamelength', 'result',
    'kills', 'deaths', 'assists', 'teamkills', 'teamdeaths',
    'damagetochampions', 'totalgold', 'total cs',
    'towers', 'dragons', 'barons', 'firstblood', 'firstdragon',
    'firstbaron', 'firsttower', 'firstherald',
    'void_grubs', 'opp_void_grubs', 'atakhans', 'opp_atakhans',
    'ban1', 'ban2', 'ban3', 'ban4', 'ban5',
]

# Minimal column set needed to build the in-memory search index
SEARCH_COLS = [
    'gameid', 'participantid', 'side', 'champion', 'teamname',
    'league', 'date', 'patch', 'gamelength', 'result', 'teamkills',
]

# International leagues — excluded from normalized WR (cross-league comparison too noisy)
INTL_LEAGUES = {'MSI', 'WLDs', 'EWC', 'DCup', 'Asia Master', 'IC', 'Americas Cup'}

TEAM_PRIOR = 20  # Bayesian shrinkage for team WRs

# Compact per-game record for the search index. blue/red are bitmasks over the
# small champion palette (one bit per champion ID) — issubset becomes a single
# bitwise AND, and each "set" is one Python int (~28 bytes) instead of a
# frozenset of strings (~440 bytes). Strings for league/date/patch/team are
# sys.intern'd so duplicates collapse to a single Python object.
Game = namedtuple('Game', 'blue red league date patch blue_team red_team '
                          'gamelength blue_result blue_kills red_kills')


def _csv_paths():
    paths = [os.path.join(CSV_DIR, f) for f in CSV_FILES]
    return [p for p in paths if os.path.exists(p)]


def _build_sqlite(csv_paths):
    """(Re)build the SQLite cache from the source CSVs.

    Lazy-imports pandas so warm boots (where the cache already exists) never
    pay the ~27 MB pandas import cost. Writes to a .tmp file then atomically
    renames so a crash mid-build does not leave a half-populated DB behind.
    """
    import pandas as pd  # noqa: PLC0415 — intentional lazy import

    tmp_path = DB_PATH + '.tmp'
    if os.path.exists(tmp_path):
        os.remove(tmp_path)

    # Compute the union of available DETAIL_COLS across all input files so the
    # table schema is stable even if columns differ year-over-year.
    available = set()
    for path in csv_paths:
        header = pd.read_csv(path, nrows=0)
        available.update(c for c in DETAIL_COLS if c in header.columns)
    cols = [c for c in DETAIL_COLS if c in available]  # preserve canonical order

    con = sqlite3.connect(tmp_path)
    try:
        for path in csv_paths:
            header = pd.read_csv(path, nrows=0)
            file_cols = [c for c in cols if c in header.columns]
            for chunk in pd.read_csv(path, usecols=file_cols, chunksize=5000,
                                     low_memory=False):
                for c in cols:
                    if c not in chunk.columns:
                        chunk[c] = None
                chunk = chunk[cols]
                chunk.to_sql('rows', con, if_exists='append', index=False)
        con.execute('CREATE INDEX idx_gameid ON rows(gameid)')
        con.commit()
    finally:
        con.close()

    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    os.rename(tmp_path, DB_PATH)


def _ensure_db(csv_paths):
    if not csv_paths:
        return
    db_mtime = os.path.getmtime(DB_PATH) if os.path.exists(DB_PATH) else 0
    csv_mtime = max(os.path.getmtime(p) for p in csv_paths)
    if db_mtime < csv_mtime:
        _build_sqlite(csv_paths)


def _to_int(v):
    if v is None:
        return 0
    try:
        return int(v)
    except (ValueError, TypeError):
        try:
            return int(float(v))
        except (ValueError, TypeError):
            return 0


def load_data():
    csv_paths = _csv_paths()
    if not csv_paths:
        return {}, [], [], {}, {}

    _ensure_db(csv_paths)

    intern = sys.intern
    con = sqlite3.connect(DB_PATH)
    try:
        # ── Champion palette → bit per champion ──
        # The full champion list (~170) fits in a single Python int per game.
        champ_to_bit = {}
        for (c,) in con.execute(
            "SELECT DISTINCT champion FROM rows "
            "WHERE participantid BETWEEN 1 AND 10 AND champion IS NOT NULL "
            "ORDER BY champion"
        ):
            c = c.strip()
            if c and c not in champ_to_bit:
                champ_to_bit[c] = 1 << len(champ_to_bit)

        # ── Per-game champion bitmasks ──
        # Single ordered scan, accumulate into (blue_mask, red_mask) per game.
        raw = {}
        for gameid, side, champ in con.execute(
            "SELECT gameid, side, champion FROM rows "
            "WHERE participantid BETWEEN 1 AND 10 AND champion IS NOT NULL "
            "ORDER BY gameid"
        ):
            if not champ:
                continue
            bit = champ_to_bit.get(champ.strip())
            if bit is None:
                continue
            entry = raw.get(gameid)
            if entry is None:
                entry = [0, 0]
                raw[gameid] = entry
            if side == 'Blue':
                entry[0] |= bit
            elif side == 'Red':
                entry[1] |= bit

        # ── Team-row metadata → final games_index ──
        games_index = {}
        team_meta = {}  # gameid → (bt_row, rt_row)
        for row in con.execute(
            "SELECT gameid, participantid, teamname, league, date, patch, "
            "gamelength, result, teamkills FROM rows "
            "WHERE participantid IN (100, 200)"
        ):
            gameid, pid, teamname, league, date, patch, gl, result, tk = row
            slot = team_meta.get(gameid)
            if slot is None:
                slot = [None, None]
                team_meta[gameid] = slot
            if pid == 100:
                slot[0] = (teamname, league, date, patch, gl, result, tk)
            elif pid == 200:
                slot[1] = (teamname, league, date, patch, gl, result, tk)

        for gameid, masks in raw.items():
            blue_mask, red_mask = masks
            if not blue_mask or not red_mask:
                continue
            slot = team_meta.get(gameid)
            if not slot or slot[0] is None or slot[1] is None:
                continue
            bt = slot[0]
            rt = slot[1]
            games_index[gameid] = Game(
                blue=blue_mask,
                red=red_mask,
                league=intern(str(bt[1])) if bt[1] is not None else '',
                date=intern(str(bt[2])) if bt[2] is not None else '',
                patch=intern(str(bt[3])) if bt[3] is not None else '',
                blue_team=intern(str(bt[0])) if bt[0] is not None else '',
                red_team=intern(str(rt[0])) if rt[0] is not None else '',
                gamelength=_to_int(bt[4]),
                blue_result=_to_int(bt[5]),
                blue_kills=_to_int(bt[6]),
                red_kills=_to_int(rt[6]),
            )

        # ── (team, league) → shrunk WR, excluding international games ──
        # GROUP BY in SQL avoids any in-Python aggregation pass.
        placeholders = ','.join('?' * len(INTL_LEAGUES))
        team_league_wr = {}
        for team, league, total, wins in con.execute(
            f"SELECT teamname, league, COUNT(*) AS n, "
            f"COALESCE(SUM(result), 0) AS w FROM rows "
            f"WHERE participantid IN (100, 200) "
            f"AND teamname IS NOT NULL AND league IS NOT NULL "
            f"AND league NOT IN ({placeholders}) "
            f"GROUP BY teamname, league",
            tuple(INTL_LEAGUES),
        ):
            total = int(total)
            wins = int(wins)
            shrunk = (wins + TEAM_PRIOR * 0.5) / (total + TEAM_PRIOR)
            team_league_wr[(intern(str(team)), intern(str(league)))] = {
                'wr': shrunk, 'wins': wins, 'games': total,
            }

        # ── (team, year) → raw WR, excluding international games ──
        # Used to display "team WR for the year of the game" next to names.
        team_year_wr = {}
        for team, year, total, wins in con.execute(
            f"SELECT teamname, substr(date, 1, 4) AS yr, COUNT(*) AS n, "
            f"COALESCE(SUM(result), 0) AS w FROM rows "
            f"WHERE participantid IN (100, 200) "
            f"AND teamname IS NOT NULL AND date IS NOT NULL "
            f"AND league IS NOT NULL "
            f"AND league NOT IN ({placeholders}) "
            f"GROUP BY teamname, yr",
            tuple(INTL_LEAGUES),
        ):
            if not year:
                continue
            total = int(total)
            wins = int(wins)
            if total <= 0:
                continue
            team_year_wr[(intern(str(team)), intern(str(year)))] = {
                'wr': wins / total, 'wins': wins, 'games': total,
            }

        # ── Autocomplete lists ──
        all_champs = sorted(champ_to_bit.keys())
        all_leagues = sorted({
            intern(l.strip()) for (l,) in con.execute(
                "SELECT DISTINCT league FROM rows "
                "WHERE participantid IN (100, 200) AND league IS NOT NULL"
            ) if l and l.strip()
        })
    finally:
        con.close()

    return (games_index, all_champs, all_leagues, team_league_wr,
            champ_to_bit, team_year_wr)


(games_index, all_champs, all_leagues, team_league_wr,
 champ_to_bit, team_year_wr) = load_data()


def fmt_gamelength(seconds):
    if not seconds:
        return '0:00'
    return f'{seconds // 60}:{seconds % 60:02d}'


def _logit(p, eps=1e-9):
    p = max(eps, min(1 - eps, p))
    return math.log(p / (1 - p))


def _sigmoid(x):
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    ex = math.exp(x)
    return ex / (1.0 + ex)


def _empty_search_response(team_a, team_b):
    return {
        'total': 0,
        'team_a_wins': 0,
        'team_a_wr': 0,
        'team_a_label': ' + '.join(team_a) if team_a else 'Team A',
        'team_b_label': ' + '.join(team_b) if team_b else 'Team B',
        'norm_total': 0,
        'norm_actual_wr': None,
        'norm_expected_wr': None,
        'normalized_wr': None,
        'games': [],
    }


# ── Routes ──

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/autocomplete')
def autocomplete():
    return jsonify({
        'champions': all_champs,
        'leagues': all_leagues,
    })


@app.route('/api/search', methods=['POST'])
def search():
    data = request.get_json()
    team_a = [c.strip() for c in data.get('team_a', []) if c and c.strip()]
    team_b = [c.strip() for c in data.get('team_b', []) if c and c.strip()]
    leagues = set(data.get('leagues', []))
    years = {str(y) for y in (data.get('years') or [])}

    if not team_a and not team_b:
        return jsonify({'error': 'Enter at least one champion'}), 400

    # OR each champion's bit into a single mask. Unknown name → impossible
    # match, short-circuit to empty.
    try:
        mask_a = 0
        for c in team_a:
            mask_a |= champ_to_bit[c]
        mask_b = 0
        for c in team_b:
            mask_b |= champ_to_bit[c]
    except KeyError:
        return jsonify(_empty_search_response(team_a, team_b))

    results = []

    def _wr_payload(team, year):
        """Look up regional-only WR for (team, year). Returns dict or None."""
        rec = team_year_wr.get((team, year))
        if not rec:
            return None
        return {
            'wr': round(100 * rec['wr'], 1),
            'wins': rec['wins'],
            'games': rec['games'],
            'year': year,
        }

    for gameid, g in games_index.items():
        if leagues and g.league not in leagues:
            continue

        blue = g.blue
        red = g.red
        year = g.date[:4] if g.date else ''

        if years and year not in years:
            continue

        # Orientation 1: Team A = Blue, Team B = Red
        if (mask_a & blue) == mask_a and (mask_b & red) == mask_b:
            results.append({
                'gameid': gameid,
                'date': g.date[:10],
                'league': g.league,
                'patch': g.patch,
                'team_a_name': g.blue_team,
                'team_b_name': g.red_team,
                'team_a_side': 'Blue',
                'team_a_win': g.blue_result == 1,
                'total_kills': g.blue_kills + g.red_kills,
                'gamelength': fmt_gamelength(g.gamelength),
                'team_a_year_wr': _wr_payload(g.blue_team, year),
                'team_b_year_wr': _wr_payload(g.red_team, year),
            })
        # Orientation 2: Team A = Red, Team B = Blue
        elif (mask_a & red) == mask_a and (mask_b & blue) == mask_b:
            results.append({
                'gameid': gameid,
                'date': g.date[:10],
                'league': g.league,
                'patch': g.patch,
                'team_a_name': g.red_team,
                'team_b_name': g.blue_team,
                'team_a_side': 'Red',
                'team_a_win': g.blue_result == 0,
                'total_kills': g.blue_kills + g.red_kills,
                'gamelength': fmt_gamelength(g.gamelength),
                'team_a_year_wr': _wr_payload(g.red_team, year),
                'team_b_year_wr': _wr_payload(g.blue_team, year),
            })

    results.sort(key=lambda x: x['date'], reverse=True)

    team_a_wins = sum(1 for r in results if r['team_a_win'])
    total = len(results)

    # Normalized WR: Log5 expected WR per game (per-league shrunk team WRs),
    # then log-odds adjustment so the result is bounded 0-100%.
    # Excludes international games (cross-league WR comparison too noisy).
    expected_wins = 0.0
    actual_wins_norm = 0
    norm_total = 0
    for r in results:
        if r['league'] in INTL_LEAGUES:
            continue
        wr_a = team_league_wr.get((r['team_a_name'], r['league']), {}).get('wr')
        wr_b = team_league_wr.get((r['team_b_name'], r['league']), {}).get('wr')
        if wr_a is None or wr_b is None:
            continue
        # Log5: P(A beats B) given both WRs against common opponents
        denom = wr_a + wr_b - 2 * wr_a * wr_b
        if denom <= 0:
            continue
        p_a = (wr_a - wr_a * wr_b) / denom
        expected_wins += p_a
        if r['team_a_win']:
            actual_wins_norm += 1
        norm_total += 1

    normalized_wr_a = None
    expected_wr = None
    actual_wr = None
    if norm_total > 0:
        actual_wr = actual_wins_norm / norm_total
        expected_wr = expected_wins / norm_total
        # Log-odds adjustment: shift actual by the bias (logit space), back to prob
        delta = _logit(actual_wr) - _logit(expected_wr)
        normalized_wr_a = _sigmoid(delta)

    return jsonify({
        'total': total,
        'team_a_wins': team_a_wins,
        'team_a_wr': round(100 * team_a_wins / total, 1) if total else 0,
        'team_a_label': ' + '.join(team_a) if team_a else 'Team A',
        'team_b_label': ' + '.join(team_b) if team_b else 'Team B',
        'norm_total': norm_total,
        'norm_actual_wr': round(100 * actual_wr, 1) if actual_wr is not None else None,
        'norm_expected_wr': round(100 * expected_wr, 1) if expected_wr is not None else None,
        'normalized_wr': round(100 * normalized_wr_a, 1) if normalized_wr_a is not None else None,
        'games': results,
    })


@app.route('/api/game/<path:gameid>')
def game_detail(gameid):
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            'SELECT * FROM rows WHERE gameid = ?', (gameid,)
        ).fetchall()
    finally:
        con.close()

    if not rows:
        return jsonify({'error': 'Game not found'}), 404

    available_cols = set(rows[0].keys())

    def safe_int(val):
        try:
            return int(val) if val is not None else 0
        except (ValueError, TypeError):
            return 0

    def safe_str(val):
        return str(val).strip() if val is not None else ''

    def get(row, key):
        return row[key] if key in available_cols else None

    def build_side(side_rows, team_pid):
        player_rows = sorted(
            [r for r in side_rows
             if r['participantid'] is not None and 1 <= r['participantid'] <= 10],
            key=lambda r: r['participantid'],
        )
        team_rows = [r for r in side_rows if r['participantid'] == team_pid]

        players = []
        for p in player_rows:
            players.append({
                'champion': safe_str(get(p, 'champion')),
                'position': safe_str(get(p, 'position')),
                'player': safe_str(get(p, 'playername')),
                'kills': safe_int(get(p, 'kills')),
                'deaths': safe_int(get(p, 'deaths')),
                'assists': safe_int(get(p, 'assists')),
                'cs': safe_int(get(p, 'total cs')),
                'gold': safe_int(get(p, 'totalgold')),
                'damage': safe_int(get(p, 'damagetochampions')),
            })

        team_stats = {}
        if team_rows:
            t = team_rows[0]
            team_stats = {
                'team': safe_str(get(t, 'teamname')),
                'result': safe_int(get(t, 'result')),
                'kills': safe_int(get(t, 'teamkills')),
                'deaths': safe_int(get(t, 'teamdeaths')),
                'towers': safe_int(get(t, 'towers')),
                'dragons': safe_int(get(t, 'dragons')),
                'barons': safe_int(get(t, 'barons')),
                'grubs': safe_int(get(t, 'void_grubs')),
                'atakhans': safe_int(get(t, 'atakhans')),
                'firstblood': safe_int(get(t, 'firstblood')),
                'firstdragon': safe_int(get(t, 'firstdragon')),
                'firstbaron': safe_int(get(t, 'firstbaron')),
                'firsttower': safe_int(get(t, 'firsttower')),
                'firstherald': safe_int(get(t, 'firstherald')),
                'bans': [safe_str(get(t, f'ban{i}')) for i in range(1, 6)],
            }

        return {'players': players, 'team_stats': team_stats}

    blue_rows = [r for r in rows if r['side'] == 'Blue']
    red_rows = [r for r in rows if r['side'] == 'Red']

    blue = build_side(blue_rows, 100)
    red = build_side(red_rows, 200)

    # Game length from team row
    team_row = [r for r in rows if r['participantid'] == 100]
    gl = safe_int(team_row[0]['gamelength']) if team_row else 0

    return jsonify({
        'blue': blue,
        'red': red,
        'gamelength': fmt_gamelength(gl),
        'total_kills': blue['team_stats'].get('kills', 0) + red['team_stats'].get('kills', 0),
    })


DISCORD_CHANNEL_ID = '1472628898935341070'
DISCORD_API_URL = (
    f'https://discord.com/api/v10/channels/{DISCORD_CHANNEL_ID}/messages'
)


@app.route('/api/discord', methods=['POST'])
def discord_post():
    token = os.environ.get('DISCORD_BOT_TOKEN')
    if not token:
        return jsonify({'error': 'DISCORD_BOT_TOKEN not configured'}), 500

    data = request.get_json() or {}
    team_a = [c for c in (data.get('team_a') or []) if c]
    team_b = [c for c in (data.get('team_b') or []) if c]
    total = data.get('total') or 0
    a_wr = data.get('team_a_wr')
    b_wr = data.get('team_b_wr')
    a_adj = data.get('team_a_adj')
    b_adj = data.get('team_b_adj')

    if not total:
        return jsonify({'error': 'No results to send'}), 400

    def fmt_pct(v):
        return f'{v}%' if v is not None else '—'

    content = (
        f"**Matchup** · {total} games\n\n"
        f"Team A: {', '.join(team_a) if team_a else '—'}\n"
        f"  Raw {fmt_pct(a_wr)}  ·  Adj {fmt_pct(a_adj)}\n\n"
        f"Team B: {', '.join(team_b) if team_b else '—'}\n"
        f"  Raw {fmt_pct(b_wr)}  ·  Adj {fmt_pct(b_adj)}"
    )

    body = json.dumps({'content': content}).encode('utf-8')
    req = urllib.request.Request(
        DISCORD_API_URL,
        data=body,
        headers={
            'Authorization': f'Bot {token}',
            'Content-Type': 'application/json',
            'User-Agent': 'matchup-finder (railway, 1.0)',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            return jsonify({'ok': True})
    except urllib.error.HTTPError as e:
        try:
            err = e.read().decode('utf-8', 'ignore')
        except Exception:
            err = str(e)
        return jsonify({'error': f'Discord {e.code}: {err}'}), 502
    except urllib.error.URLError as e:
        return jsonify({'error': f'Network error: {e.reason}'}), 502


if __name__ == '__main__':
    app.run(debug=True, port=5000)
