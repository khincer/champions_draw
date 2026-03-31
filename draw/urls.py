from django.urls import path

from .views import (
    SeasonListAPIView,
    SeasonSeedingAPIView,
    TeamDetailAPIView,
    TeamListAPIView,
)

app_name = 'draw'

urlpatterns = [
    path('seasons/', SeasonListAPIView.as_view(), name='season-list'),
    path('seasons/<int:pk>/seed/', SeasonSeedingAPIView.as_view(), name='season-seed'),
    path('teams/', TeamListAPIView.as_view(), name='team-list'),
    path('teams/<int:pk>/', TeamDetailAPIView.as_view(), name='team-detail'),
]