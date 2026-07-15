def generate_knockout_bracket(standings, playoff_winners):
    """
    Generate the full knockout bracket from R16 through Final.

    R16 pairs top 8 (1-8) against playoff winners:
      [1] vs PW(16v17), [2] vs PW(15v18), [3] vs PW(14v19),
      [4] vs PW(13v20), [5] vs PW(12v21), [6] vs PW(11v22),
      [7] vs PW(10v23), [8] vs PW(9v24)

    QF bracket from R16 winners:
      QF1: R16W1 vs R16W2
      QF2: R16W3 vs R16W4
      QF3: R16W5 vs R16W6
      QF4: R16W7 vs R16W8

    SF bracket from QF winners:
      SF1: QFW1 vs QFW2
      SF2: QFW3 vs QFW4

    Final: SFW1 vs SFW2

    Args:
        standings: list from standings.compute_standings()
        playoff_winners: dict mapping matchup_index (1-8) to team dict

    Returns:
        Nested dict structure:
        {
            'rounds': {
                'R16': [{bracket_position, home_team, away_team, round_label}, ...],
                'QF': [{bracket_position, round_label}, ...],
                'SF': [{bracket_position, round_label}, ...],
                'F':  [{bracket_position, round_label}, ...],
            }
        }
    """
    top8 = {s['position']: s for s in standings if s['position'] <= 8}

    r16_matchups = [
        (1, 1, 8),
        (2, 2, 7),
        (3, 3, 6),
        (4, 4, 5),
        (5, 5, 4),
        (6, 6, 3),
        (7, 7, 2),
        (8, 8, 1),
    ]

    rounds = {}

    r16 = []
    for pos, bp, pw_idx in r16_matchups:
        top_team = top8.get(pos)
        pw = playoff_winners.get(pw_idx)
        if top_team and pw:
            r16.append({
                'bracket_position': bp,
                'home_team': top_team,
                'away_team': pw,
                'round': 'R16',
                'round_label': f'Round of 16 #{bp}',
            })
        elif top_team:
            r16.append({
                'bracket_position': bp,
                'home_team': top_team,
                'away_team': None,
                'round': 'R16',
                'round_label': f'Round of 16 #{bp}',
            })
    rounds['R16'] = r16

    qf_pairs = [(1, 2), (3, 4), (5, 6), (7, 8)]
    qf = []
    for idx, (p1, p2) in enumerate(qf_pairs, start=1):
        qf.append({
            'bracket_position': idx,
            'home_source': ('R16', p1),
            'away_source': ('R16', p2),
            'round': 'QF',
            'round_label': f'Quarter-final #{idx}',
        })
    rounds['QF'] = qf

    sf_pairs = [(1, 2), (3, 4)]
    sf = []
    for idx, (p1, p2) in enumerate(sf_pairs, start=1):
        sf.append({
            'bracket_position': idx,
            'home_source': ('QF', p1),
            'away_source': ('QF', p2),
            'round': 'SF',
            'round_label': f'Semi-final #{idx}',
        })
    rounds['SF'] = sf

    rounds['F'] = [
        {
            'bracket_position': 1,
            'home_source': ('SF', 1),
            'away_source': ('SF', 2),
            'round': 'F',
            'round_label': 'Final',
        }
    ]

    return rounds
