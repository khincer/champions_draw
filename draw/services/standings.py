from collections import defaultdict


def compute_standings(teams, match_predictions):
    """
    Compute league table from match predictions.

    Args:
        teams: list of SeasonTeam dicts with id, name, etc.
        match_predictions: list of dicts with home_team_id, away_team_id,
                          home_goals, away_goals

    Returns:
        List of dicts sorted by position (1-36), each with:
        {position, team_id, name, short_name, logo_url, association,
         played, wins, draws, losses, goals_for, goals_against,
         goal_diff, points}
    """
    stats = {
        t['id']: {
            'team_id': t['id'],
            'name': t['name'],
            'short_name': t['short_name'],
            'logo_url': t.get('logo_url', ''),
            'association': t.get('association'),
            'played': 0,
            'wins': 0,
            'draws': 0,
            'losses': 0,
            'goals_for': 0,
            'goals_against': 0,
            'goal_diff': 0,
            'points': 0,
        }
        for t in teams
    }

    for mp in match_predictions:
        hg = mp.get('home_goals')
        ag = mp.get('away_goals')
        home_id = mp.get('home_team_id') or mp.get('home_team', {}).get('id')
        away_id = mp.get('away_team_id') or mp.get('away_team', {}).get('id')
        if hg is None or ag is None:
            continue
        if home_id not in stats or away_id not in stats:
            continue

        stats[home_id]['played'] += 1
        stats[away_id]['played'] += 1
        stats[home_id]['goals_for'] += hg
        stats[home_id]['goals_against'] += ag
        stats[away_id]['goals_for'] += ag
        stats[away_id]['goals_against'] += hg

        if hg > ag:
            stats[home_id]['wins'] += 1
            stats[home_id]['points'] += 3
            stats[away_id]['losses'] += 1
        elif hg < ag:
            stats[away_id]['wins'] += 1
            stats[away_id]['points'] += 3
            stats[home_id]['losses'] += 1
        else:
            stats[home_id]['draws'] += 1
            stats[home_id]['points'] += 1
            stats[away_id]['draws'] += 1
            stats[away_id]['points'] += 1

    for row in stats.values():
        row['goal_diff'] = row['goals_for'] - row['goals_against']

    sorted_teams = sorted(
        stats.values(),
        key=lambda r: (-r['points'], -r['goal_diff'], -r['goals_for'], -r['wins']),
    )

    for i, row in enumerate(sorted_teams):
        row['position'] = i + 1

    return sorted_teams


def get_playoff_teams(standings):
    """Return teams in positions 9-24 from computed standings."""
    return [s for s in standings if 9 <= s['position'] <= 24]


def get_top8_teams(standings):
    """Return teams in positions 1-8 from computed standings."""
    return [s for s in standings if s['position'] <= 8]
