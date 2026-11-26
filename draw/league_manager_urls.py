from django.urls import include, path

from .league_manager_views import (
    ManagedLeagueCollectionAPIView,
    ManagedLeagueDetailAPIView,
    ManagedLeagueGenerateAPIView,
    ManagedLeagueResultAPIView,
    ManagedLeagueRosterAPIView,
    SharedManagedLeagueAPIView,
)


urlpatterns = [
    path('account/', include('draw.league_manager_accounts')),
    path('leagues/', ManagedLeagueCollectionAPIView.as_view(), name='managed-league-list'),
    path('leagues/<int:league_id>/', ManagedLeagueDetailAPIView.as_view(), name='managed-league-detail'),
    path('leagues/<int:league_id>/teams/', ManagedLeagueRosterAPIView.as_view(), name='managed-league-teams'),
    path('leagues/<int:league_id>/generate/', ManagedLeagueGenerateAPIView.as_view(), name='managed-league-generate'),
    path(
        'leagues/<int:league_id>/fixtures/<int:fixture_id>/result/',
        ManagedLeagueResultAPIView.as_view(),
        name='managed-league-result',
    ),
    path('shared/<uuid:share_id>/', SharedManagedLeagueAPIView.as_view(), name='shared-managed-league'),
]
