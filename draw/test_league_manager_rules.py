from collections import Counter, defaultdict
from itertools import combinations
from unittest import TestCase


class LeagueManagerRulesTests(TestCase):
    def test_round_robin_covers_every_pair_once_and_balances_venues(self):
        from draw.services.league_manager import round_robin

        for count in [2, 4, 5, 36]:
            with self.subTest(count=count):
                team_ids = list(range(1, count + 1))
                rounds = defaultdict(list)
                pairs = []
                venue_totals = Counter()
                for matchday, home, away in round_robin(team_ids):
                    pairs.append(tuple(sorted((home, away))))
                    rounds[matchday].extend((home, away))
                    venue_totals[home] += 1
                    venue_totals[away] -= 1

                self.assertCountEqual(pairs, combinations(team_ids, 2))
                self.assertEqual(list(rounds), list(range(1, count + count % 2)))
                byes = Counter()
                for participants in rounds.values():
                    self.assertEqual(len(participants), len(set(participants)))
                    self.assertEqual(len(participants), count - count % 2)
                    byes.update(set(team_ids) - set(participants))
                self.assertEqual(byes, Counter(team_ids) if count % 2 else Counter())
                self.assertTrue(all(abs(venue_totals[team]) <= 1 for team in team_ids))

    def test_standings_count_nil_nil_and_leave_unplayed_teams_at_zero(self):
        from draw.services.league_manager import managed_standings

        teams = [{'id': 1, 'name': 'Avon'}, {'id': 2, 'name': 'Bourne'}, {'id': 3, 'name': 'Cove'}]
        fixtures = [
            {'home_team_id': 1, 'away_team_id': 2, 'home_goals': 0, 'away_goals': 0},
            {'home_team_id': 1, 'away_team_id': 3, 'home_goals': None, 'away_goals': None},
        ]
        rows = managed_standings(teams, fixtures)
        self.assertEqual([(r['position'], r['name'], r['played'], r['points']) for r in rows], [
            (1, 'Avon', 1, 1), (1, 'Bourne', 1, 1), (3, 'Cove', 0, 0),
        ])
        self.assertEqual(rows[0]['draws'], 1)

    def test_standings_sort_by_points_goal_difference_and_goals_scored(self):
        from draw.services.league_manager import managed_standings

        teams = [{'id': i, 'name': name} for i, name in enumerate('ABCDE', start=1)]
        fixtures = [
            {'home_team_id': 1, 'away_team_id': 5, 'home_goals': 1, 'away_goals': 0},
            {'home_team_id': 2, 'away_team_id': 5, 'home_goals': 3, 'away_goals': 1},
            {'home_team_id': 3, 'away_team_id': 5, 'home_goals': 2, 'away_goals': 0},
            {'home_team_id': 4, 'away_team_id': 5, 'home_goals': 0, 'away_goals': 2},
        ]
        rows = managed_standings(teams, fixtures)
        self.assertEqual([row['name'] for row in rows], list('BCAED'))
        self.assertEqual((rows[0]['wins'], rows[0]['goals_for'], rows[0]['goals_against'], rows[0]['goal_diff']), (1, 3, 1, 2))
        self.assertEqual((rows[-1]['losses'], rows[-1]['goal_diff']), (1, -2))
