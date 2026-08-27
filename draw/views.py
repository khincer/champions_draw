from dataclasses import asdict
from collections import Counter

from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import League, LeagueStanding, Season, SeasonDraw, SeasonMatchup, SeasonTeam
from .serializers import (
	CompactSeasonMatchupSerializer,
	CompactSeasonTeamSerializer,
	SeasonDrawSerializer,
	SeasonMatchupSerializer,
	SeasonSerializer,
	SeasonTeamSerializer,
)
from .services.draw import DrawError, generate_season_draw
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
	permission_classes = [IsAuthenticated]

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


class SeasonDrawAPIView(APIView):
	def post(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		draw_seed = request.data.get('seed')
		player_name = request.data.get('player_name', '')
		method = str(request.data.get('method', 'sat'))
		reset = parse_bool(request.data.get('reset', False))

		try:
			summary = generate_season_draw(
				season,
				draw_seed=draw_seed,
				player_name=player_name,
				reset=reset,
				method=method,
			)
		except DrawError as exc:
			return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

		matchups = get_season_matchups(season)
		return Response(
			{
				'summary': asdict(summary),
				'season': SeasonSerializer(season).data,
				'matchups': SeasonMatchupSerializer(matchups, many=True).data,
			},
			status=status.HTTP_200_OK,
		)


class SeasonMatchupListAPIView(generics.ListAPIView):
	serializer_class = SeasonMatchupSerializer

	def get_queryset(self):
		season = get_object_or_404(Season, pk=self.kwargs['pk'])
		return get_season_matchups(season)


class SeasonDrawListAPIView(generics.ListAPIView):
	serializer_class = SeasonDrawSerializer

	def get_queryset(self):
		season = get_object_or_404(Season, pk=self.kwargs['pk'])
		return SeasonDraw.objects.filter(season=season).order_by('-created_at')


class UiSeasonStateAPIView(APIView):
	def get(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		entries = list(
			SeasonTeam.objects.select_related('season', 'team', 'team__association')
			.filter(season=season)
			.order_by('pot', 'seeding_position', 'team__name')
		)
		matchups = list(get_season_matchups(season))
		draws = list(SeasonDraw.objects.filter(season=season).order_by('-created_at')[:12])
		pot_sizes = Counter(entry.pot for entry in entries if entry.pot is not None)

		return Response(
			{
				'season': SeasonSerializer(season).data,
				'summary': {
					'team_count': len(entries),
					'seeded_team_count': sum(1 for entry in entries if entry.seeding_position is not None),
					'matchup_count': len(matchups),
					'draw_count': SeasonDraw.objects.filter(season=season).count(),
					'pot_sizes': {pot: pot_sizes[pot] for pot in sorted(pot_sizes)},
				},
				'teams': CompactSeasonTeamSerializer(entries, many=True).data,
				'matchups': CompactSeasonMatchupSerializer(matchups, many=True).data,
				'draws': SeasonDrawSerializer(draws, many=True).data,
			},
			status=status.HTTP_200_OK,
		)


def get_season_matchups(season: Season):
	return (
		SeasonMatchup.objects.select_related(
			'season',
			'home_team__season',
			'home_team__team',
			'home_team__team__association',
			'away_team__season',
			'away_team__team',
			'away_team__team__association',
		)
		.filter(season=season)
		.order_by('matchday', 'home_team__team__name', 'away_team__team__name')
	)


def parse_bool(value) -> bool:
	if isinstance(value, bool):
		return value
	if isinstance(value, str):
		return value.strip().lower() in {'1', 'true', 'yes', 'on'}
	return bool(value)


# --- Leagues & Standings ---


class LeagueListAPIView(generics.ListAPIView):
	serializer_class = None

	def get(self, request):
		leagues = League.objects.filter(is_active=True)
		data = [
			{
				'id': lg.id,
				'code': lg.code,
				'name': lg.name,
				'country': lg.country,
				'emblem_url': lg.emblem_url,
			}
			for lg in leagues
		]
		return Response(data)


class LeagueStandingListAPIView(APIView):
	def get(self, request, league_id):
		league = get_object_404(League, pk=league_id)
		season_year = request.query_params.get('season')
		qs = LeagueStanding.objects.filter(league=league)
		if season_year:
			qs = qs.filter(season_year=int(season_year))
		else:
			latest_year = qs.order_by('-season_year').values_list('season_year', flat=True).first()
			if latest_year is not None:
				qs = qs.filter(season_year=latest_year)
		data = list(qs.values(
			'position', 'team_name', 'team_crest', 'played',
			'won', 'draw', 'lost', 'goals_for', 'goals_against',
			'goal_difference', 'points',
		).order_by('position'))
		return Response({
			'league': {'id': league.id, 'code': league.code, 'name': league.name, 'emblem_url': league.emblem_url},
			'standings': data,
		})


# --- Homepage: recent + upcoming matches ---


class HomepageMatchesAPIView(APIView):
	def get(self, request):
		season = get_requested_or_active_season(request)
		matchups = list(
			SeasonMatchup.objects.select_related(
				'home_team__team', 'away_team__team',
			).filter(season=season)
		)

		recent = []
		upcoming = []
		for m in matchups:
			row = {
				'id': m.id,
				'home_team': CompactSeasonTeamSerializer(m.home_team).data,
				'away_team': CompactSeasonTeamSerializer(m.away_team).data,
				'matchday': m.matchday,
				'home_goals': m.home_goals,
				'away_goals': m.away_goals,
				'status': m.status,
				'kickoff': m.kickoff.isoformat() if m.kickoff else None,
			}
			if m.status == 'FINISHED':
				recent.append(row)
			elif m.status in ('SCHEDULED', 'TIMED', '') and m.kickoff:
				upcoming.append(row)

		recent.sort(key=lambda r: r['matchday'] or 0, reverse=True)
		upcoming.sort(key=lambda r: r['kickoff'] or '')

		return Response({
			'recent': recent[:20],
			'upcoming': upcoming[:20],
		})
