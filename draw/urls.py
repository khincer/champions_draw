from django.urls import path

from .views import (
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
]
