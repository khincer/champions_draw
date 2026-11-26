MIN_TEAMS = 2
MAX_TEAMS = 36
MAX_GOALS = 999


def round_robin(team_ids):
    """Return one (matchday, home, away) triple for each unordered pair."""
    ring = list(team_ids)
    if not MIN_TEAMS <= len(ring) <= MAX_TEAMS or len(set(ring)) != len(ring) or None in ring:
        raise ValueError('A round robin needs 2 to 36 distinct team IDs.')
    if len(ring) % 2:
        ring.insert(0, None)

    fixtures = []
    for matchday in range(1, len(ring)):
        for index in range(len(ring) // 2):
            home, away = ring[index], ring[-1 - index]
            if home is None or away is None:
                continue
            if index == 0 and matchday % 2 == 0:
                home, away = away, home
            fixtures.append((matchday, home, away))
        ring = [ring[0], ring[-1], *ring[1:-1]]
    return fixtures


def managed_standings(teams, fixtures):
    rows = {
        team['id']: dict(
            team_id=team['id'], name=team['name'], played=0, wins=0, draws=0,
            losses=0, goals_for=0, goals_against=0, goal_diff=0, points=0,
        )
        for team in teams
    }
    for fixture in fixtures:
        home_goals, away_goals = fixture['home_goals'], fixture['away_goals']
        if home_goals is None or away_goals is None:
            continue
        home = rows[fixture['home_team_id']]
        away = rows[fixture['away_team_id']]
        for row, scored, conceded in ((home, home_goals, away_goals), (away, away_goals, home_goals)):
            row['played'] += 1
            row['goals_for'] += scored
            row['goals_against'] += conceded
            row['goal_diff'] += scored - conceded
            if scored > conceded:
                row['wins'] += 1
                row['points'] += 3
            elif scored == conceded:
                row['draws'] += 1
                row['points'] += 1
            else:
                row['losses'] += 1

    def rank_key(row):
        return -row['points'], -row['goal_diff'], -row['goals_for']

    ranked = sorted(rows.values(), key=lambda row: (*rank_key(row), row['name'].casefold(), row['team_id']))
    last_key = None
    for index, row in enumerate(ranked, start=1):
        key = rank_key(row)
        if key != last_key:
            position = index
            last_key = key
        row['position'] = position
    return ranked
