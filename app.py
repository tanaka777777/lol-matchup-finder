import os
import pandas as pd
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# ── Load CSVs at startup ──
CSV_DIR = os.path.join(os.path.dirname(__file__), '..')
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


def load_data():
    frames = []
    for year in ['2025', '2026']:
        path = os.path.join(CSV_DIR, f'{year}_LoL_esports_match_data_from_OraclesElixir.csv')
        if os.path.exists(path):
            frames.append(pd.read_csv(path, encoding='utf-8', low_memory=False))
    if not frames:
        return pd.DataFrame(), {}, [], []

    df = pd.concat(frames, ignore_index=True)

    players = df[df['participantid'].between(1, 10)]
    teams = df[df['participantid'].isin([100, 200])]

    # Build per-game index for fast searching
    games_index = {}
    for gameid, grp in players.groupby('gameid'):
        blue = grp[grp['side'] == 'Blue']
        red = grp[grp['side'] == 'Red']
        blue_champs = set(blue['champion'].dropna().str.strip())
        red_champs = set(red['champion'].dropna().str.strip())
        if not blue_champs or not red_champs:
            continue
        games_index[gameid] = {
            'blue_champs': blue_champs,
            'red_champs': red_champs,
        }

    # Merge team-level data
    for gameid, grp in teams.groupby('gameid'):
        if gameid not in games_index:
            continue
        blue_t = grp[grp['participantid'] == 100]
        red_t = grp[grp['participantid'] == 200]
        if blue_t.empty or red_t.empty:
            continue
        bt = blue_t.iloc[0]
        rt = red_t.iloc[0]
        games_index[gameid].update({
            'blue_team': str(bt['teamname']),
            'red_team': str(rt['teamname']),
            'league': str(bt['league']),
            'date': str(bt['date']),
            'patch': str(bt['patch']),
            'gamelength': int(bt['gamelength']) if pd.notna(bt['gamelength']) else 0,
            'blue_result': int(bt['result']) if pd.notna(bt['result']) else 0,
            'blue_kills': int(bt['teamkills']) if pd.notna(bt['teamkills']) else 0,
            'red_kills': int(rt['teamkills']) if pd.notna(rt['teamkills']) else 0,
        })

    # Remove incomplete entries
    games_index = {k: v for k, v in games_index.items() if 'league' in v}

    # Extract autocomplete lists
    all_champs = sorted(players['champion'].dropna().str.strip().unique())
    all_leagues = sorted(teams['league'].dropna().str.strip().unique())

    # Keep slimmed df for detail endpoint
    keep_cols = [c for c in DETAIL_COLS if c in df.columns]
    detail_df = df[keep_cols].copy()

    return detail_df, games_index, all_champs, all_leagues


detail_df, games_index, all_champs, all_leagues = load_data()


def fmt_gamelength(seconds):
    if not seconds:
        return '0:00'
    return f'{seconds // 60}:{seconds % 60:02d}'


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

    if not team_a and not team_b:
        return jsonify({'error': 'Enter at least one champion'}), 400

    set_a = set(team_a)
    set_b = set(team_b)
    results = []

    for gameid, g in games_index.items():
        if leagues and g['league'] not in leagues:
            continue

        blue = g['blue_champs']
        red = g['red_champs']

        # Orientation 1: Team A = Blue, Team B = Red
        if set_a.issubset(blue) and set_b.issubset(red):
            results.append({
                'gameid': gameid,
                'date': g['date'][:10],
                'league': g['league'],
                'patch': g['patch'],
                'team_a_name': g['blue_team'],
                'team_b_name': g['red_team'],
                'team_a_side': 'Blue',
                'team_a_win': g['blue_result'] == 1,
                'total_kills': g['blue_kills'] + g['red_kills'],
                'gamelength': fmt_gamelength(g['gamelength']),
            })
        # Orientation 2: Team A = Red, Team B = Blue
        elif set_a.issubset(red) and set_b.issubset(blue):
            results.append({
                'gameid': gameid,
                'date': g['date'][:10],
                'league': g['league'],
                'patch': g['patch'],
                'team_a_name': g['red_team'],
                'team_b_name': g['blue_team'],
                'team_a_side': 'Red',
                'team_a_win': g['blue_result'] == 0,
                'total_kills': g['blue_kills'] + g['red_kills'],
                'gamelength': fmt_gamelength(g['gamelength']),
            })

    results.sort(key=lambda x: x['date'], reverse=True)

    team_a_wins = sum(1 for r in results if r['team_a_win'])
    total = len(results)

    return jsonify({
        'total': total,
        'team_a_wins': team_a_wins,
        'team_a_wr': round(100 * team_a_wins / total, 1) if total else 0,
        'team_a_label': ' + '.join(team_a) if team_a else 'Team A',
        'team_b_label': ' + '.join(team_b) if team_b else 'Team B',
        'games': results,
    })


@app.route('/api/game/<path:gameid>')
def game_detail(gameid):
    rows = detail_df[detail_df['gameid'] == gameid]
    if rows.empty:
        return jsonify({'error': 'Game not found'}), 404

    def safe_int(val):
        try:
            return int(val) if pd.notna(val) else 0
        except (ValueError, TypeError):
            return 0

    def safe_str(val):
        return str(val).strip() if pd.notna(val) else ''

    def build_side(side_rows, team_pid):
        player_rows = side_rows[side_rows['participantid'].between(1, 10)].sort_values('participantid')
        team_row = side_rows[side_rows['participantid'] == team_pid]

        players = []
        for _, p in player_rows.iterrows():
            players.append({
                'champion': safe_str(p.get('champion', '')),
                'position': safe_str(p.get('position', '')),
                'player': safe_str(p.get('playername', '')),
                'kills': safe_int(p.get('kills', 0)),
                'deaths': safe_int(p.get('deaths', 0)),
                'assists': safe_int(p.get('assists', 0)),
                'cs': safe_int(p.get('total cs', 0)),
                'gold': safe_int(p.get('totalgold', 0)),
                'damage': safe_int(p.get('damagetochampions', 0)),
            })

        team_stats = {}
        if not team_row.empty:
            t = team_row.iloc[0]
            team_stats = {
                'team': safe_str(t.get('teamname', '')),
                'result': safe_int(t.get('result', 0)),
                'kills': safe_int(t.get('teamkills', 0)),
                'deaths': safe_int(t.get('teamdeaths', 0)),
                'towers': safe_int(t.get('towers', 0)),
                'dragons': safe_int(t.get('dragons', 0)),
                'barons': safe_int(t.get('barons', 0)),
                'grubs': safe_int(t.get('void_grubs', 0)),
                'atakhans': safe_int(t.get('atakhans', 0)),
                'firstblood': safe_int(t.get('firstblood', 0)),
                'firstdragon': safe_int(t.get('firstdragon', 0)),
                'firstbaron': safe_int(t.get('firstbaron', 0)),
                'firsttower': safe_int(t.get('firsttower', 0)),
                'firstherald': safe_int(t.get('firstherald', 0)),
                'bans': [safe_str(t.get(f'ban{i}', '')) for i in range(1, 6)],
            }

        return {'players': players, 'team_stats': team_stats}

    blue_rows = rows[rows['side'] == 'Blue']
    red_rows = rows[rows['side'] == 'Red']

    blue = build_side(blue_rows, 100)
    red = build_side(red_rows, 200)

    # Game length from team row
    team_row = rows[rows['participantid'] == 100]
    gl = safe_int(team_row.iloc[0]['gamelength']) if not team_row.empty else 0

    return jsonify({
        'blue': blue,
        'red': red,
        'gamelength': fmt_gamelength(gl),
        'total_kills': blue['team_stats'].get('kills', 0) + red['team_stats'].get('kills', 0),
    })


if __name__ == '__main__':
    app.run(debug=True, port=5000)
