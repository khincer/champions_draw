from django.urls import path

from .predictions_views import (
    KnockoutBracketAPIView,
    MatchPredictionBulkSyncAPIView,
    MatchPredictionUpdateAPIView,
    PlayoffBracketAPIView,
    PlayoffBracketSyncAPIView,
    PredictionCreateGetAPIView,
    PredictionDetailAPIView,
    StandingsAPIView,
)
from .views import (
	HomepageMatchesAPIView,
	LeagueListAPIView,
	LeagueStandingListAPIView,
	SeasonDrawAPIView,
	SeasonDrawListAPIView,
	SeasonListAPIView,
	SeasonMatchupListAPIView,
	SeasonSeedingAPIView,
	TeamDetailAPIView,
	TeamListAPIView,
	TeamOverviewAPIView,
	UiSeasonStateAPIView,
)

app_name = 'draw'

urlpatterns = [
    path('seasons/', SeasonListAPIView.as_view(), name='season-list'),
    path('seasons/<int:pk>/seed/', SeasonSeedingAPIView.as_view(), name='season-seed'),
    path('seasons/<int:pk>/draw/', SeasonDrawAPIView.as_view(), name='season-draw'),
    path('seasons/<int:pk>/draws/', SeasonDrawListAPIView.as_view(), name='season-draw-list'),
    path('seasons/<int:pk>/matchups/', SeasonMatchupListAPIView.as_view(), name='season-matchup-list'),
    path('ui/seasons/<int:pk>/state/', UiSeasonStateAPIView.as_view(), name='ui-season-state'),
    path('teams/', TeamListAPIView.as_view(), name='team-list'),
    path('teams/overview/', TeamOverviewAPIView.as_view(), name='team-overview'),
    path('teams/<int:pk>/', TeamDetailAPIView.as_view(), name='team-detail'),
    # Leagues & standings
    path('leagues/', LeagueListAPIView.as_view(), name='league-list'),
    path('leagues/<int:league_id>/standings/', LeagueStandingListAPIView.as_view(), name='league-standings'),
    # Homepage
    path('homepage/matches/', HomepageMatchesAPIView.as_view(), name='homepage-matches'),
    # Prediction endpoints
    path('predictions/', PredictionCreateGetAPIView.as_view(), name='prediction-create'),
    path('predictions/<int:pk>/', PredictionDetailAPIView.as_view(), name='prediction-detail'),
    path('predictions/<int:pk>/matches/<int:matchup_pk>/', MatchPredictionUpdateAPIView.as_view(), name='match-prediction-update'),
    path('predictions/<int:pk>/sync/', MatchPredictionBulkSyncAPIView.as_view(), name='match-prediction-sync'),
    path('predictions/<int:pk>/standings/', StandingsAPIView.as_view(), name='prediction-standings'),
    path('predictions/<int:pk>/playoffs/', PlayoffBracketAPIView.as_view(), name='playoff-bracket'),
    path('predictions/<int:pk>/playoffs/sync/', PlayoffBracketSyncAPIView.as_view(), name='playoff-bracket-sync'),
    path('predictions/<int:pk>/knockout/', KnockoutBracketAPIView.as_view(), name='knockout-bracket'),
]
