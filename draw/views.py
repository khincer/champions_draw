from dataclasses import asdict
from collections import Counter

from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Season, SeasonTeam
from .serializers import SeasonSerializer, SeasonTeamSerializer
from .services.seeding import SeedingError, seed_season_entries


def get_requested_or_active_season(request) -> Season:
	season_name = request.query_params.get('season')
	if season_name:
		return get_object_or_404(Season, name=season_name)

	season = Season.objects.filter(is_active=True).order_by('-name').first()
	if season is None:
		raise NotFound('No active season found. Provide ?season=<season-name>.')

	return season


class SeasonListAPIView(generics.ListAPIView):
	queryset = Season.objects.all()
	serializer_class = SeasonSerializer


class TeamListAPIView(generics.ListAPIView):
	serializer_class = SeasonTeamSerializer

	def get_queryset(self):
		season = get_requested_or_active_season(self.request)
		return (
			SeasonTeam.objects.select_related('season', 'team', 'team__association')
			.filter(season=season)
			.order_by('pot', 'seeding_position', 'team__name')
		)


class TeamDetailAPIView(generics.RetrieveAPIView):
	queryset = SeasonTeam.objects.select_related('season', 'team', 'team__association')
	serializer_class = SeasonTeamSerializer


class TeamOverviewAPIView(APIView):
	def get(self, request):
		season = get_requested_or_active_season(request)
		entries = list(
			SeasonTeam.objects.select_related('season', 'team', 'team__association')
			.filter(season=season)
			.order_by('pot', 'seeding_position', 'team__name')
		)
		pot_sizes = Counter(entry.pot for entry in entries if entry.pot is not None)

		return Response(
			{
				'season': SeasonSerializer(season).data,
				'summary': {
					'team_count': len(entries),
					'seeded_team_count': sum(1 for entry in entries if entry.seeding_position is not None),
					'pot_sizes': {pot: pot_sizes[pot] for pot in sorted(pot_sizes)},
				},
				'teams': SeasonTeamSerializer(entries, many=True).data,
			},
			status=status.HTTP_200_OK,
		)


class SeasonSeedingAPIView(APIView):
	def post(self, request, pk):
		season = get_object_or_404(Season, pk=pk)

		try:
			summary = seed_season_entries(season)
		except SeedingError as exc:
			return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

		seeded_entries = (
			SeasonTeam.objects.select_related('season', 'team', 'team__association')
			.filter(season=season)
			.order_by('pot', 'seeding_position', 'team__name')
		)

		return Response(
			{
				'summary': asdict(summary),
				'season': SeasonSerializer(season).data,
				'teams': SeasonTeamSerializer(seeded_entries, many=True).data,
			},
			status=status.HTTP_200_OK,
		)
