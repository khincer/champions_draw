import json
import time
from collections import Counter, defaultdict
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import django
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .management.commands.sync_real_fixture_results import (
    PROMIEDOS_URL,
    fetch,
    parse_promiedos_live,
    resolve,
)

from .models import (
	InteractiveDrawPick,
	League,
	LeagueMatch,
	LeagueStanding,
	Prediction,
	RealFixturePrediction,
	Season,
	SeasonDraw,
	SeasonMatchup,
	SeasonTeam,
)
from .serializers import (
	CompactSeasonMatchupSerializer,
	CompactSeasonTeamSerializer,
	SeasonDrawSerializer,
	SeasonMatchupSerializer,
	SeasonSerializer,
	SeasonTeamSerializer,
	_normalize_team_name,
)
from .services.draw import DrawError, generate_season_draw
from .services.interactive_draw import current_pot, pick_team, start_or_resume
from .services.match_details import build_header, find_listing_match, load_football_data_listing, map_detail
from .services.seeding import SeedingError, seed_season_entries
from .services.standings import compute_standings


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

		# Cleanup all prediction data for this season on every fresh simulation.
		# Cascade deletes wipe MatchPrediction/PlayoffPrediction/KnockoutPrediction
		# via the FK to Prediction.  Matches are only wiped by the draw services
		# themselves, so placing this here covers both the interactive and SAT
		# paths in a single call site.
		if reset:
			Prediction.objects.filter(season=season).delete()

		if method == 'interactive':
			try:
				draw = start_or_resume(
					season=season,
					draw_seed=draw_seed,
					player_name=player_name,
					reset=reset,
				)
			except DrawError as exc:
				return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
			return Response(_interactive_state(season, draw), status=status.HTTP_200_OK)

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


class InteractivePickAPIView(APIView):
	"""Apply one manual ceremony pick against the running interactive draw."""

	def post(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		season_team_id = request.data.get('season_team_id')
		if season_team_id is None:
			return Response(
				{'detail': 'season_team_id is required.'},
				status=status.HTTP_400_BAD_REQUEST,
			)
		try:
			draw = start_or_resume(
				season=season,
				draw_seed=request.data.get('seed', 'interactive'),
				player_name=request.data.get('player_name', ''),
				reset=False,
			)
			result = pick_team(
				season=season,
				draw=draw,
				season_team_id=int(season_team_id),
			)
		except (DrawError, ValueError) as exc:
			return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

		payload = _interactive_state(season, result.draw)
		payload['auto_finalized'] = result.auto_finalized
		return Response(payload, status=status.HTTP_200_OK)


def _interactive_state(season: Season, draw: SeasonDraw) -> dict:
	"""State payload the manual draw UI needs: draw, teams, provisional
	matchups, picks in order, and the pot currently on the clock."""
	entries = list(
		SeasonTeam.objects.select_related('season', 'team', 'team__association')
		.filter(season=season)
		.order_by('pot', 'seeding_position', 'team__name')
	)
	matchups = list(get_season_matchups(season))
	picks = list(
		InteractiveDrawPick.objects.filter(draw=draw)
		.order_by('pick_order')
		.values('season_team_id', 'pick_order')
	)
	return {
		'draw': SeasonDrawSerializer(draw).data,
		'teams': CompactSeasonTeamSerializer(entries, many=True).data,
		'matchups': CompactSeasonMatchupSerializer(matchups, many=True).data,
		'picks': picks,
		'current_pot': current_pot(draw),
	}


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


def _load_real_fixtures(season: Season) -> list:
	"""Read the real league-phase fixtures joined to SeasonTeam entries.

	Returns the same payload shape RealSeasonFixturesAPIView serves, so
	prediction sync and the fixtures endpoint agree on ids, teams, and the
	closed computation.
	"""
	fixtures_path = Path(__file__).resolve().parent / 'data' / 'ucl_league_phase_real_fixtures_2026_27.json'
	with open(fixtures_path, 'r', encoding='utf-8') as f:
		data = json.load(f)

	entries = SeasonTeam.objects.select_related('team', 'team__association').filter(season=season)
	team_map = {}
	for entry in entries:
		team_map[_normalize_team_name(entry.team.name)] = entry
		team_map[entry.team.name] = entry

	matchups = []
	matchday_idx = defaultdict(int)
	for fixture in data['fixtures']:
		md = fixture['matchday']
		matchday_idx[md] += 1
		idx = matchday_idx[md]

		home_name = fixture['home']
		away_name = fixture['away']
		home_entry = team_map.get(home_name) or team_map.get(_normalize_team_name(home_name))
		away_entry = team_map.get(away_name) or team_map.get(_normalize_team_name(away_name))

		if home_entry is None:
			raise NotFound(f'Team not found in season: {home_name}')
		if away_entry is None:
			raise NotFound(f'Team not found in season: {away_name}')

		# Fixtures close 10 minutes before kickoff. Kickoff is a naive
		# Europe/Paris wall-time string from the seed JSON.
		kickoff_utc = (
			datetime.fromisoformat(fixture['kickoff'])
			.replace(tzinfo=ZoneInfo('Europe/Paris'))
			.astimezone(timezone.utc)
		)
		closed = datetime.now(timezone.utc) >= (kickoff_utc - timedelta(minutes=10))

		matchups.append({
			'id': f'real-{md}-{idx}',
			'home_team': CompactSeasonTeamSerializer(home_entry).data,
			'away_team': CompactSeasonTeamSerializer(away_entry).data,
			'home_entry': home_entry,
			'away_entry': away_entry,
			'matchday': md,
			'home_goals': None,
			'away_goals': None,
			'status': 'SCHEDULED',
			# Serve the kickoff as an absolute UTC instant so the client can
			# format it in the user's local timezone (naive strings would be
			# misread as local wall time).
			'kickoff': kickoff_utc.isoformat().replace('+00:00', 'Z'),
			'result': fixture.get('result'),
			'closed': closed,
		})

	return matchups


class RealSeasonFixturesAPIView(APIView):
	def get(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		matchups = _load_real_fixtures(season)

		# Strip the ORM entry refs before serializing the payload.
		for m in matchups:
			m.pop('home_entry', None)
			m.pop('away_entry', None)

		return Response({
			'season': SeasonSerializer(season).data,
			'matchups': matchups,
		}, status=status.HTTP_200_OK)


class RealPredictionSyncAPIView(APIView):
	"""Read/write RealFixturePrediction rows keyed by fixture id (`real-{md}-{idx}`)."""

	def get(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		player_name = request.query_params.get('player_name', '').strip()
		if not player_name:
			return Response({'player_name': player_name, 'predictions': []}, status=status.HTTP_200_OK)

		prediction = Prediction.objects.filter(season=season, player_name=player_name).first()
		if prediction is None:
			return Response({'player_name': player_name, 'predictions': []}, status=status.HTTP_200_OK)

		fixture_by_teams = {(m['home_entry'].id, m['away_entry'].id): m for m in _load_real_fixtures(season)}
		rows = RealFixturePrediction.objects.filter(prediction=prediction)
		predictions = []
		for row in rows:
			fixture = fixture_by_teams.get((row.home_team_id, row.away_team_id))
			if fixture is None:
				continue
			predictions.append({
				'id': fixture['id'],
				'home_goals': row.home_goals,
				'away_goals': row.away_goals,
			})

		return Response({'player_name': player_name, 'predictions': predictions}, status=status.HTTP_200_OK)

	def put(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		player_name = str(request.data.get('player_name', '')).strip()
		if not player_name:
			return Response({'detail': 'player_name is required'}, status=status.HTTP_400_BAD_REQUEST)

		predictions_data = request.data.get('predictions', [])
		fixtures = _load_real_fixtures(season)
		fixture_by_id = {m['id']: m for m in fixtures}

		closed_ids = []
		for item in predictions_data:
			fixture = fixture_by_id.get(item.get('id'))
			if fixture is None:
				return Response({'detail': f'Unknown fixture id: {item.get("id")}'}, status=status.HTTP_400_BAD_REQUEST)
			if fixture['closed']:
				closed_ids.append(fixture['id'])

		# All-or-nothing: reject the whole batch if any fixture is closed.
		if closed_ids:
			return Response(
				{'detail': 'Prediction closed for some fixtures', 'closed': closed_ids},
				status=status.HTTP_400_BAD_REQUEST,
			)

		prediction, _ = Prediction.objects.get_or_create(
			season=season,
			player_name=player_name,
			defaults={'season': season, 'player_name': player_name},
		)

		synced = 0
		for item in predictions_data:
			fixture = fixture_by_id[item['id']]
			_, created = RealFixturePrediction.objects.update_or_create(
				prediction=prediction,
				home_team=fixture['home_entry'],
				away_team=fixture['away_entry'],
				defaults={
					'matchday': fixture['matchday'],
					'home_goals': item.get('home_goals'),
					'away_goals': item.get('away_goals'),
				},
			)
			synced += 1

		return Response({'synced': synced}, status=status.HTTP_200_OK)


# Short TTL so several viewers polling every 30s don't each hit promiedos; a
# 15s cache caps upstream traffic at ~4 fetches/min regardless of audience.
_PROMIEDOS_LIVE_CACHE = {'at': 0.0, 'html': None}


def _fetch_promiedos_live_html():
	now = time.monotonic()
	cached = _PROMIEDOS_LIVE_CACHE
	if cached['html'] is None or now - cached['at'] > 15:
		cached['html'] = fetch(PROMIEDOS_URL, source='Promiedos')
		cached['at'] = now
	return cached['html']


class LiveScoresAPIView(APIView):
	"""Current in-play scores for the real fixtures, labeled by fixture id.

	Polled by the frontend every 30s while a matchday is in progress. Nothing
	is persisted here: final results keep flowing through the fixtures JSON.
	A promiedos outage returns 502 with an empty payload, so the UI simply
	keeps showing 'Awaiting result' rows instead of failing.
	"""

	def get(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		matchups = _load_real_fixtures(season)

		fixture_id_by_pair = {}
		for m in matchups:
			key = (resolve(m['home_team']['name']), resolve(m['away_team']['name']))
			fixture_id_by_pair.setdefault(key, m['id'])

		try:
			live_games = parse_promiedos_live(_fetch_promiedos_live_html())
		except (RuntimeError, ValueError, KeyError, IndexError, json.JSONDecodeError) as exc:
			return Response({'live': {}, 'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

		live = {}
		for game in live_games:
			fixture_id = fixture_id_by_pair.get((resolve(game['home']), resolve(game['away'])))
			if fixture_id is None:
				continue  # not one of our league-phase fixtures
			live[fixture_id] = {
				'home_goals': game['home_goals'],
				'away_goals': game['away_goals'],
				'status': game['status'],
			}
		return Response({'live': live}, status=status.HTTP_200_OK)


class MatchDetailsAPIView(APIView):
	"""Match detail: header from own fixtures, detail from football-data listing."""

	def get(self, request, pk, fixture_id):
		season = get_object_or_404(Season, pk=pk)
		now = datetime.now(timezone.utc)
		fixtures = _load_real_fixtures(season)

		fixture = None
		for f in fixtures:
			if f['id'] == fixture_id:
				fixture = f
				break
		if fixture is None:
			raise NotFound(f'Fixture not found: {fixture_id}')

		# Eligibility: must have a result OR kickoff has passed
		result = fixture.get('result')
		kickoff_dt = datetime.fromisoformat(fixture['kickoff'].replace('Z', '+00:00'))
		if result is None and now < kickoff_dt:
			raise NotFound('Fixture not yet eligible for details')

		header = build_header(fixture, now)

		detail = None
		detail_error = None
		try:
			listing = load_football_data_listing(season.name)
			match = find_listing_match(
				listing,
				home_name=fixture['home_team']['name'],
				away_name=fixture['away_team']['name'],
				matchday=fixture['matchday'],
			)
			detail = map_detail(match)
			if detail is None:
				detail_error = (
					f"No football-data mapping found for "
					f"{fixture['home_team']['name']} vs {fixture['away_team']['name']}"
				)
		except (RuntimeError, KeyError) as exc:
			detail = None
			detail_error = f'Upstream listing unavailable: {exc}'

		return Response({
			'fixture': {k: v for k, v in fixture.items() if k not in ('home_entry', 'away_entry')},
			'header': header,
			'detail': detail,
			'detail_error': detail_error,
			'timeline': None,
			'lineups': None,
		}, status=status.HTTP_200_OK)


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
		conmebol_emblems = {
			'LIB': 'https://media.api-sports.io/football/leagues/13.png',
			'SUD': 'https://media.api-sports.io/football/leagues/11.png',
		}
		conmebol = [
			{
				'id': f'season-{s.pk}',
				'code': s.competition,
				'name': s.name,
				'country': 'CONMEBOL',
				'emblem_url': conmebol_emblems.get(s.competition),
				'kind': 'season',
				'season_id': s.pk,
			}
			for s in Season.objects.filter(competition__in=['LIB', 'SUD']).order_by('-name')
		]
		data.extend(conmebol)
		return Response(data)


# --- Season group standings (CONMEBOL) ---


class SeasonGroupStandingsAPIView(APIView):
	"""Group-stage standings for a CONMEBOL season.

	Groups are derived from the matchup graph: every SeasonMatchup with a
	matchday becomes an edge between its two SeasonTeam nodes, and each
	connected component is one group (8 groups of 4 in the CONMEBOL format,
	but derived generically). Components are labeled 'A', 'B', ... in
	alphabetical order of their member team names."""

	def get(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		if season.competition not in ('LIB', 'SUD'):
			raise NotFound('Group standings only exist for CONMEBOL seasons.')

		matchups = list(
			SeasonMatchup.objects.select_related('home_team__team', 'away_team__team')
			.filter(season=season, matchday__isnull=False)
		)

		# Union-find over SeasonTeam ids; each connected component is a group.
		parent = {}

		def find(node):
			root = node
			while parent[root] != root:
				root = parent[root]
			while parent[node] != node:
				parent[node], node = root, parent[node]
			return root

		def union(a, b):
			ra, rb = find(a), find(b)
			if ra != rb:
				parent[rb] = ra

		for m in matchups:
			parent.setdefault(m.home_team_id, m.home_team_id)
			parent.setdefault(m.away_team_id, m.away_team_id)
			union(m.home_team_id, m.away_team_id)

		components = {}
		for node_id in parent:
			components.setdefault(find(node_id), []).append(node_id)

		entries = {
			st.id: st
			for st in SeasonTeam.objects.select_related('team', 'team__association')
			.filter(season=season, id__in=parent)
		}

		def team_payload(st):
			return {
				'id': st.id,
				'name': st.team.name,
				'short_name': st.team.short_name or st.team.name,
				'logo_url': st.team.logo_url or '',
				'association': st.team.association.code if st.team.association else '',
			}

		def standings_payload(member_ids):
			teams = [team_payload(entries[nid]) for nid in member_ids]
			group_matchups = [
				m for m in matchups
				if m.home_team_id in member_ids and m.away_team_id in member_ids
			]
			return compute_standings(
				teams,
				[{
					'home_team_id': m.home_team_id,
					'away_team_id': m.away_team_id,
					'home_goals': m.home_goals,
					'away_goals': m.away_goals,
				} for m in group_matchups],
			)

		# Label components A..Z ordered by their member team names.
		member_ids_by_component = sorted(
			components.values(),
			key=lambda ids: [entries[nid].team.name for nid in ids],
		)
		groups = []
		for idx, raw_ids in enumerate(member_ids_by_component):
			label = chr(ord('A') + idx)
			member_ids = sorted(raw_ids, key=lambda nid: entries[nid].team.name)
			groups.append({
				'group': label,
				'standings': standings_payload(member_ids),
			})

		return Response({'season_id': season.pk, 'groups': groups})


class LeagueStandingListAPIView(APIView):
	def get(self, request, league_id):
		league = get_object_or_404(League, pk=league_id)
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


class LeagueFixtureListAPIView(APIView):
	def get(self, request, league_id):
		league = get_object_or_404(League, pk=league_id)
		now = django.utils.timezone.now()
		qs = LeagueMatch.objects.filter(league=league)
		finished = qs.filter(status='FINISHED', kickoff__lte=now).order_by('-kickoff')[:30]
		upcoming = qs.filter(kickoff__gt=now).order_by('kickoff')[:30]

		def ser(m):
			return {
				'id': m.match_id,
				'home_name': m.home_name,
				'away_name': m.away_name,
				'home_short': m.home_short,
				'away_short': m.away_short,
				'home_crest': m.home_crest,
				'away_crest': m.away_crest,
				'kickoff': m.kickoff.isoformat() if m.kickoff else None,
				'status': m.status,
				'matchday': m.matchday,
				'result': (
					{'home_goals': m.home_goals, 'away_goals': m.away_goals}
					if m.home_goals is not None and m.away_goals is not None
					else None
				),
			}

		return Response({
			'league': {'id': league.id, 'code': league.code, 'name': league.name, 'emblem_url': league.emblem_url},
			'finished': [ser(m) for m in finished],
			'upcoming': [ser(m) for m in upcoming],
		})


# --- Homepage: recent + upcoming matches ---


class HomepageMatchesAPIView(APIView):
	"""Homepage feed: today/yesterday real fixtures for the newest UCL season
	plus every CONMEBOL (Libertadores/Sudamericana) season's matchups.

	The frontend filters by inHomeRange client-side, so all rows are served and
	the kickoff-bearing subset renders. Rows carry a per-match season_id and
	competition label; only UCL rows are openable (match details resolve for
	them; CONMEBOL matchups have no detail endpoint)."""

	def get(self, request):
		rows = []
		# The UCL block is best-effort: real fixtures only load for the newest
		# UCL season (2026-27), and any failure must not take down the CONMEBOL
		# rows below. An explicit ?season= override wins when provided.
		try:
			season_name = request.query_params.get('season')
			if season_name:
				ucl_season = get_object_or_404(Season, name=season_name)
			else:
				ucl_season = Season.objects.filter(competition='UCL').order_by('-name').first()
			if ucl_season is not None:
				for f in _load_real_fixtures(ucl_season):
					rows.append({
						'id': f['id'],
						'season_id': ucl_season.id,
						'competition': 'Champions League',
						'openable': True,
						'home_team': f['home_team'],
						'away_team': f['away_team'],
						'matchday': f['matchday'],
						'kickoff': f['kickoff'],
						'result': f.get('result'),
						'closed': f.get('closed', False),
						'status': f.get('status', 'SCHEDULED'),
					})
		except Exception:
			# UCL fixture loading must never take down the feed; the CONMEBOL
			# rows below still render even when this fails.
			pass
		conmebol_seasons = list(Season.objects.filter(competition__in=['LIB', 'SUD']).order_by('-name'))
		if conmebol_seasons:
			matchups = list(
				SeasonMatchup.objects.select_related(
					'home_team__team', 'away_team__team',
				).filter(season__in=conmebol_seasons)
			)
			competition_label = {'LIB': 'Libertadores', 'SUD': 'Sudamericana'}
			for m in matchups:
				if not m.kickoff:
					continue
				rows.append({
					'id': f'sm-{m.id}',
					'season_id': m.season_id,
					'competition': competition_label.get(m.season.competition, m.season.competition),
					'openable': False,
					'home_team': CompactSeasonTeamSerializer(m.home_team).data,
					'away_team': CompactSeasonTeamSerializer(m.away_team).data,
					'matchday': m.matchday,
					'kickoff': m.kickoff.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
					'result': (
						{'home_goals': m.home_goals, 'away_goals': m.away_goals}
						if m.status == 'FINISHED' and m.home_goals is not None and m.away_goals is not None
						else None
					),
					'closed': m.status == 'FINISHED',
					'status': m.status,
				})
		rows.sort(key=lambda r: r['kickoff'] or '')
		return Response({'matchups': rows})
