def generate_playoff_matchups(standings):
    """
    Generate the 8 playoff ties from league standings.

    Pairings (two-legged):
      9  vs 24
      10 vs 23
      11 vs 22
      12 vs 21
      13 vs 20
      14 vs 19
      15 vs 18
      16 vs 17

    Higher seed (lower position number) is home_team (plays leg 1 away, leg 2 at home).

    Args:
        standings: list from standings.compute_standings()

    Returns:
        List of dicts: {matchup_index, home_team, away_team, higher_seed_id, lower_seed_id}
    """
    playoff_teams = {s['position']: s for s in standings if 9 <= s['position'] <= 24}

    pairings = [
        (9, 24),
        (10, 23),
        (11, 22),
        (12, 21),
        (13, 20),
        (14, 19),
        (15, 18),
        (16, 17),
    ]

    matchups = []
    for idx, (higher_pos, lower_pos) in enumerate(pairings, start=1):
        higher = playoff_teams.get(higher_pos)
        lower = playoff_teams.get(lower_pos)
        if not higher or not lower:
            continue
        matchups.append({
            'matchup_index': idx,
            'home_team': higher,
            'away_team': lower,
            'higher_seed_id': higher['team_id'],
            'lower_seed_id': lower['team_id'],
        })

    return matchups


def compute_playoff_winner(leg1_home, leg1_away, leg2_home, leg2_away,
                           home_team_id, away_team_id,
                           et_home=None, et_away=None,
                           pen_home=None, pen_away=None):
    """
    Determine playoff winner from two-legged aggregate + tiebreakers.

    Tiebreakers (applied in order):
      1. Extra time goals added to aggregate
      2. Penalty shootout winner (if still tied after ET)

    Returns team_id of the winner, or None if scores are not set or still tied.
    """
    if any(x is None for x in [leg1_home, leg1_away, leg2_home, leg2_away]):
        return None

    agg_home = leg1_away + leg2_home
    agg_away = leg1_home + leg2_away

    if agg_home > agg_away:
        return home_team_id
    elif agg_away > agg_home:
        return away_team_id

    # Aggregate tied — apply extra time (played in leg 2)
    if et_home is not None and et_away is not None:
        agg_home += et_home
        agg_away += et_away
        if agg_home > agg_away:
            return home_team_id
        elif agg_away > agg_home:
            return away_team_id

        # Still tied after ET — apply penalties
        if pen_home is not None and pen_away is not None:
            if pen_home > pen_away:
                return home_team_id
            elif pen_away > pen_home:
                return away_team_id

    # Still tied / no tiebreaker data — unresolved
    return None
