from django.test import TestCase
from rest_framework.test import APIClient

from .models import Association, MatchPrediction, Prediction, Season, SeasonMatchup, SeasonTeam, Team


class PredictionSyncTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.season = Season.objects.create(name='Predictions 1')
        self.other_season = Season.objects.create(name='Predictions 2')
        association = Association.objects.create(name='Test Association', code='TST')
        home = Team.objects.create(name='Home Team', short_name='HOME', association=association)
        away = Team.objects.create(name='Away Team', short_name='AWAY', association=association)

        def create_matchup(season):
            home_entry = SeasonTeam.objects.create(season=season, team=home, uefa_club_coefficient=1, pot=1)
            away_entry = SeasonTeam.objects.create(season=season, team=away, uefa_club_coefficient=1, pot=1)
            return SeasonMatchup.objects.create(season=season, home_team=home_entry, away_team=away_entry, matchday=1)

        self.matchup = create_matchup(self.season)
        self.other_matchup = create_matchup(self.other_season)
        self.prediction = Prediction.objects.create(season=self.season, player_name='Ada')
        self.url = f'/api/predictions/{self.prediction.pk}'

    def sync(self, *scores):
        return self.client.post(f'{self.url}/sync/', {'predictions': list(scores)}, format='json')

    def test_bulk_sync_upserts_missing_rows_and_clears_standings_with_null_scores(self):
        response = self.sync({'matchup': self.matchup.pk, 'home_goals': 2, 'away_goals': 0})
        self.assertEqual(response.json(), {'synced': 1})
        standings = self.client.get(f'{self.url}/standings/').json()
        self.assertEqual(sorted(row['points'] for row in standings), [0, 3])

        response = self.sync({'matchup': self.matchup.pk, 'home_goals': None, 'away_goals': None})
        self.assertEqual(response.json(), {'synced': 1})
        score = MatchPrediction.objects.get(prediction=self.prediction, matchup=self.matchup)
        self.assertIsNone(score.home_goals)
        self.assertIsNone(score.away_goals)
        standings = self.client.get(f'{self.url}/standings/').json()
        self.assertEqual([row['points'] for row in standings], [0, 0])

    def test_bulk_sync_rejects_wrong_season_without_saving_any_scores(self):
        response = self.sync(
            {'matchup': self.matchup.pk, 'home_goals': 1, 'away_goals': 0},
            {'matchup': self.other_matchup.pk, 'home_goals': 2, 'away_goals': 0},
        )
        self.assertEqual(response.status_code, 409)
        self.assertFalse(MatchPrediction.objects.filter(prediction=self.prediction).exists())

    def test_single_score_write_cannot_target_another_seasons_matchup(self):
        response = self.client.put(
            f'{self.url}/matches/{self.other_matchup.pk}/',
            {'home_goals': 1, 'away_goals': 0}, format='json',
        )
        self.assertEqual(response.status_code, 404)
        self.assertFalse(MatchPrediction.objects.filter(prediction=self.prediction).exists())
