import json
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

import django
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .management.commands.sync_real_fixture_results import (
	parse_promiedos_live,
	resolve_live,
)

from .models import (
	League,
	LeagueMatch,
	LeagueMatchPrediction,
	LeagueStanding,
	Prediction,
	RealFixturePrediction,
	Season,
	SeasonDraw,
	SeasonMatchup,
	SeasonTeam,
)
from .selectors import (
	active_season,
	fetch_promiedos_live_html,
	get_season_matchups,
	interactive_state,
	league_fixture_state,
	load_real_fixtures,
	promiedos_live_url,
)
from .serializers import (
	CompactSeasonMatchupSerializer,
	CompactSeasonTeamSerializer,
	SeasonDrawSerializer,
	SeasonMatchupSerializer,
	SeasonSerializer,
	SeasonTeamSerializer,
	serialize_league_match,
)
from .services.draw import DrawError, generate_season_draw
from .services.interactive_draw import pick_team, start_or_resume
from .services.match_details import (
	build_header,
	build_league_header,
	find_league_listing_match,
	find_listing_match,
	load_football_data_league,
	load_football_data_listing,
	map_detail,
	map_league_detail,
	season_year_for,
)
from .services.seeding import SeedingError, seed_season_entries
from .services.standings import compute_standings


def get_requested_or_active_season(request) -> Season:
	season_name = request.query_params.get('season')
	if season_name:
		return get_object_or_404(Season, name=season_name)

	season = active_season()
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
			return Response(interactive_state(season, draw), status=status.HTTP_200_OK)

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

		payload = interactive_state(season, result.draw)
		payload['auto_finalized'] = result.auto_finalized
		return Response(payload, status=status.HTTP_200_OK)


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


class RealSeasonFixturesAPIView(APIView):
	def get(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		matchups = load_real_fixtures(season)

		for m in matchups:
			m.pop('home_entry', None)
			m.pop('away_entry', None)

		return Response({
			'season': SeasonSerializer(season).data,
			'matchups': matchups,
		}, status=status.HTTP_200_OK)


class RealPredictionSyncAPIView(APIView):

	def get(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		player_name = request.query_params.get('player_name', '').strip()
		if not player_name:
			return Response({'player_name': player_name, 'predictions': []}, status=status.HTTP_200_OK)

		prediction = Prediction.objects.filter(season=season, player_name=player_name).first()
		if prediction is None:
			return Response({'player_name': player_name, 'predictions': []}, status=status.HTTP_200_OK)

		fixture_by_teams = {(m['home_entry'].id, m['away_entry'].id): m for m in load_real_fixtures(season)}
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
		fixtures = load_real_fixtures(season)
		fixture_by_id = {m['id']: m for m in fixtures}

		closed_ids = []
		for item in predictions_data:
			fixture = fixture_by_id.get(item.get('id'))
			if fixture is None:
				return Response({'detail': f'Unknown fixture id: {item.get("id")}'}, status=status.HTTP_400_BAD_REQUEST)
			if fixture['closed']:
				closed_ids.append(fixture['id'])

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


class LiveScoresAPIView(APIView):

	def get(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		matchups = load_real_fixtures(season)

		live_url = promiedos_live_url(season.competition)
		if live_url is None:
			# No live source for this competition (the friendlies league has no
			# working league page). Nothing is live, which is not an error.
			return Response({'live': {}}, status=status.HTTP_200_OK)

		fixture_id_by_pair = {}
		for m in matchups:
			key = (resolve_live(m['home_team']['name']), resolve_live(m['away_team']['name']))
			fixture_id_by_pair.setdefault(key, m['id'])

		try:
			live_games = parse_promiedos_live(fetch_promiedos_live_html(live_url))
		except (RuntimeError, ValueError, KeyError, IndexError, json.JSONDecodeError) as exc:
			return Response({'live': {}, 'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

		live = {}
		for game in live_games:
			fixture_id = fixture_id_by_pair.get((resolve_live(game['home']), resolve_live(game['away'])))
			if fixture_id is None:
				continue  # not one of our league-phase fixtures
			live[fixture_id] = {
				'home_goals': game['home_goals'],
				'away_goals': game['away_goals'],
				'status': game['status'],
			}
		return Response({'live': live}, status=status.HTTP_200_OK)


class MatchDetailsAPIView(APIView):

	def get(self, request, pk, fixture_id):
		season = get_object_or_404(Season, pk=pk)
		now = datetime.now(timezone.utc)
		fixtures = load_real_fixtures(season)

		fixture = None
		for f in fixtures:
			if f['id'] == fixture_id:
				fixture = f
				break
		if fixture is None:
			raise NotFound(f'Fixture not found: {fixture_id}')

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


class LeagueMatchDetailsAPIView(APIView):
	"""Match detail for a real-league fixture.

	Header comes from LeagueMatch; detail comes from the league's football-data
	listing (matched by fixture id). A league-scoped route because LeagueMatch
	has no Season FK: the league id is the natural scope and it leaves the
	season-scoped UCL route above untouched.
	"""

	def get(self, request, league_id, match_id):
		league = get_object_or_404(League, pk=league_id)
		match = LeagueMatch.objects.filter(league=league, match_id=match_id).first()
		if match is None:
			raise NotFound(f'Fixture not found: {match_id}')

		now = datetime.now(timezone.utc)
		if match.status != 'FINISHED' and (match.kickoff is None or now < match.kickoff):
			raise NotFound('Fixture not yet eligible for details')

		header = build_league_header(match)

		detail = None
		detail_error = None
		try:
			listing = load_football_data_league(league.code, season_year_for(match.kickoff))
			fd_match = find_league_listing_match(listing, match.match_id)
			detail = map_league_detail(fd_match)
			if detail is None:
				detail_error = (
					f'No football-data mapping found for '
					f'{match.home_name} vs {match.away_name}'
				)
		except (RuntimeError, KeyError) as exc:
			detail = None
			detail_error = f'Upstream listing unavailable: {exc}'

		return Response({
			'fixture': {
				'id': f'lm-{match.match_id}',
				'home_name': match.home_name,
				'away_name': match.away_name,
				'kickoff': match.kickoff.isoformat().replace('+00:00', 'Z') if match.kickoff else None,
				'status': match.status,
				'matchday': match.matchday,
			},
			'header': header,
			'detail': detail,
			'detail_error': detail_error,
			'timeline': None,
			'lineups': None,
		}, status=status.HTTP_200_OK)


def parse_bool(value) -> bool:
	if isinstance(value, bool):
		return value
	if isinstance(value, str):
		return value.strip().lower() in {'1', 'true', 'yes', 'on'}
	return bool(value)


# --- Leagues & Standings ---

# Competition metadata keyed by code, shared by the league list and the homepage
# feed: it doubles as the serve list and the label source, so a competition
# cannot be served-but-unlabelled. CONMEBOL seasons carry no emblem in their own
# data, so the api-sports crests stand in — the same convention the team-logo
# backfill uses. Friendlies (FRN) and the Nations League (UNL) have no crest of
# their own, hence None.
COMPETITION_META = {
	'LIB': {'label': 'Libertadores', 'country': 'CONMEBOL', 'emblem_url': 'https://media.api-sports.io/football/leagues/13.png'},
	'SUD': {'label': 'Sudamericana', 'country': 'CONMEBOL', 'emblem_url': 'https://media.api-sports.io/football/leagues/11.png'},
	'FRN': {'label': 'International Friendlies', 'country': 'International', 'emblem_url': None},
	'UNL': {'label': 'Nations League', 'country': 'International', 'emblem_url': None},
}

# Non-UCL seasons surfaced by the league list and the homepage feed. Derived from
# COMPETITION_META (insertion order preserved) rather than repeated as a literal,
# so a code cannot be served by one surface while missing from the label map.
NON_UCL_COMPETITIONS = tuple(COMPETITION_META)


def competition_meta(code):
	"""Label/country/emblem for a competition code.

	The `.get()` fallback returns the raw code with no country and no emblem, so
	an unknown competition can never inherit another one's metadata."""
	return COMPETITION_META.get(code, {'label': code, 'country': '', 'emblem_url': None})

# football-data's Champions League crest. UCL homepage rows come from a static
# fixture JSON with no emblem, so this mirrors the `League.emblem_url` the UCL
# league row already carries instead of leaving the pill name-only.
UCL_EMBLEM_URL = 'https://crests.football-data.org/CL.png'


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
		season_leagues = [
			{
				'id': f'season-{s.pk}',
				'code': s.competition,
				'name': s.name,
				'country': competition_meta(s.competition)['country'],
				'emblem_url': competition_meta(s.competition)['emblem_url'],
				'kind': 'season',
				'season_id': s.pk,
			}
			for s in Season.objects.filter(competition__in=NON_UCL_COMPETITIONS).order_by('-name')
		]
		data.extend(season_leagues)
		return Response(data)




class SeasonGroupStandingsAPIView(APIView):
	"""Group-stage standings for a non-UCL season.

	Groups are derived from the matchup graph: every SeasonMatchup with a
	matchday becomes an edge between its two SeasonTeam nodes, and each
	connected component is one group (8 groups of 4 in the CONMEBOL format,
	but derived generically). Components are labeled 'A', 'B', ... in
	alphabetical order of their member team names.

	Nations League (UNL) matchups carry a matchday ("Fecha N"), so they get
	real derived group tables. Friendlies seasons (FRN) have no matchday, so
	they return an empty `groups` list with a 200 rather than a 404 — the
	teams-browser panel renders empty instead of erroring."""

	def get(self, request, pk):
		season = get_object_or_404(Season, pk=pk)
		if season.competition not in NON_UCL_COMPETITIONS:
			raise NotFound('Group standings only exist for non-UCL seasons.')

		matchups = list(
			SeasonMatchup.objects.select_related('home_team__team', 'away_team__team')
			.filter(season=season, matchday__isnull=False)
		)

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


def _clean_goals(value):
	"""A non-negative int or None; ValueError on anything else (bad score)."""
	if value is None or value == '':
		return None
	# `bool` is an int subclass: reject it explicitly so `True` is not goal 1.
	if isinstance(value, bool) or not isinstance(value, (int, str)):
		raise ValueError('Goals must be a non-negative integer')
	try:
		number = int(value)
	except (TypeError, ValueError):
		raise ValueError('Goals must be a non-negative integer')
	if number < 0:
		raise ValueError('Goals must be a non-negative integer')
	return number


class LeagueMatchPredictionAPIView(APIView):
	"""Per-match score picks for one real league.

	GET  /api/leagues/<league_id>/predictions/?player_name=X
	PUT  /api/leagues/<league_id>/predictions/

	The read mirrors the sibling `/matches/` contract (last 30 finished + next
	30 upcoming) so the page never pulls a whole season; each fixture carries
	the player's pick, the real result, and whether it is still open. Matches
	that have kicked off but not finished come back in `inPlay` so a just-made
	pick never vanishes at kickoff.
	"""

	def get(self, request, league_id):
		league = get_object_or_404(League, pk=league_id)
		player_name = request.query_params.get('player_name', '').strip()
		now = django.utils.timezone.now()
		qs = LeagueMatch.objects.filter(league=league)

		# Matchday-scoped, not a rolling window. The page predicts exactly one
		# matchday -- the next one to be played -- and reports exactly one, the
		# last one completed. A rolling window of finished/upcoming fixtures mixed
		# matchdays together, so a half-played matchday sat beside the next one.
		completed_matchdays = sorted(
			md for md in qs.filter(status='FINISHED').values_list('matchday', flat=True).distinct()
			if md is not None
		)
		last_completed = completed_matchdays[-1] if completed_matchdays else None

		# The next matchday is the one after the last completed one, NOT the lowest
		# matchday holding an unplayed fixture. La Liga carries a rescheduled
		# matchday-6 fixture with a future kickoff while matchdays 6 and 7 are both
		# already played, so the kickoff-only rule picked matchday 6 and offered that
		# single stray fixture while hiding the real next matchday.
		next_matchday = (last_completed + 1) if last_completed is not None else None

		# Fall back to the old rolling window when the league carries no matchday
		# information at all. Scoping strictly would hide every fixture instead,
		# which is worse than mixing matchdays together.
		if last_completed is not None:
			finished = qs.filter(matchday=last_completed, status='FINISHED').order_by('kickoff')
		else:
			finished = qs.filter(status='FINISHED', kickoff__lte=now).order_by('-kickoff')[:30]

		# Kicked off but not final (IN_PLAY, PAUSED, .): visible, read-only picks.
		# Left unscoped on purpose -- these belong to the matchday being played,
		# which is neither the last completed nor the next one.
		in_play = qs.filter(kickoff__lte=now).exclude(status='FINISHED').order_by('kickoff')

		if next_matchday is not None:
			# Everything still open up to and including the next matchday, so a
			# rescheduled fixture from an earlier matchday stays predictable instead
			# of vanishing. Later matchdays are excluded: those are not on offer yet.
			upcoming = (
				qs.filter(kickoff__gt=now)
				.exclude(matchday__gt=next_matchday)
				.order_by('kickoff')
			)
		else:
			upcoming = qs.filter(kickoff__gt=now).order_by('kickoff')[:30]

		by_match_id = {}
		if player_name:
			by_match_id = {
				p.match.match_id: p
				for p in LeagueMatchPrediction.objects.filter(
					match__league=league,
					player_name=player_name,
				).select_related('match')
			}

		return Response({
			'league': {'id': league.id, 'code': league.code, 'name': league.name, 'emblem_url': league.emblem_url},
			'player_name': player_name,
			'finished': [serialize_league_match(m, by_match_id.get(m.match_id), now) for m in finished],
			'inPlay': [serialize_league_match(m, by_match_id.get(m.match_id), now) for m in in_play],
			'upcoming': [serialize_league_match(m, by_match_id.get(m.match_id), now) for m in upcoming],
		})

	def put(self, request, league_id):
		league = get_object_or_404(League, pk=league_id)
		player_name = str(request.data.get('player_name', '')).strip()
		if not player_name:
			return Response({'detail': 'player_name is required'}, status=status.HTTP_400_BAD_REQUEST)

		predictions_data = request.data.get('predictions', [])
		if not isinstance(predictions_data, list):
			return Response({'detail': 'predictions must be a list'}, status=status.HTTP_400_BAD_REQUEST)

		now = django.utils.timezone.now()
		by_match_id = {m.match_id: m for m in LeagueMatch.objects.filter(league=league)}
		resolved = []
		closed_ids = []
		unscheduled_ids = []
		for item in predictions_data:
			if not isinstance(item, dict):
				return Response({'detail': 'Each prediction must be an object'}, status=status.HTTP_400_BAD_REQUEST)
			match_id = item.get('match_id')
			match = by_match_id.get(match_id)
			if match is None:
				return Response({'detail': f'Unknown fixture id: {match_id}'}, status=status.HTTP_400_BAD_REQUEST)
			state = league_fixture_state(match, now)
			if state == 'unscheduled':
				unscheduled_ids.append(match_id)
			elif state == 'closed':
				closed_ids.append(match_id)
			try:
				home_goals = _clean_goals(item.get('home_goals'))
				away_goals = _clean_goals(item.get('away_goals'))
			except ValueError as exc:
				return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
			resolved.append((match, home_goals, away_goals))

		# All-or-nothing: nothing is written unless every target accepts a pick.
		if unscheduled_ids:
			return Response(
				{'detail': 'Fixture not scheduled', 'unscheduled': unscheduled_ids},
				status=status.HTTP_400_BAD_REQUEST,
			)
		if closed_ids:
			return Response(
				{'detail': 'Prediction closed for some fixtures', 'closed': closed_ids},
				status=status.HTTP_400_BAD_REQUEST,
			)

		synced = 0
		for match, home_goals, away_goals in resolved:
			LeagueMatchPrediction.objects.update_or_create(
				match=match,
				player_name=player_name,
				defaults={'home_goals': home_goals, 'away_goals': away_goals},
			)
			synced += 1

		return Response({'synced': synced}, status=status.HTTP_200_OK)


# --- Homepage: recent + upcoming matches ---


def _kickoff_closed(kickoff):
	"""True once a fixture's predictions have closed (10 minutes before kickoff).

	Kickoffs come back naive from SQLite, so they are pinned to UTC before the
	comparison. Comparing a naive datetime against an aware `now` raises, and that
	took the whole homepage feed down rather than degrading one row.
	"""
	if kickoff is None:
		return False
	if kickoff.tzinfo is None:
		kickoff = kickoff.replace(tzinfo=timezone.utc)
	return datetime.now(timezone.utc) >= (kickoff - timedelta(minutes=10))


class HomepageMatchesAPIView(APIView):
	"""Homepage feed: today/yesterday real fixtures for the newest UCL season
	plus every non-UCL season's matchups (CONMEBOL + international friendlies).

	The frontend filters by inHomeRange client-side, so all rows are served and
	the kickoff-bearing subset renders. Rows carry a per-match season_id,
	competition label, and (for league rows) league_id. UCL and league rows are
	openable; CONMEBOL and friendlies matchups have no detail endpoint."""

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
				for f in load_real_fixtures(ucl_season):
					rows.append({
						'id': f['id'],
						'season_id': ucl_season.id,
						'competition': 'Champions League',
						'competition_emblem': UCL_EMBLEM_URL,
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
		season_leagues = list(Season.objects.filter(competition__in=NON_UCL_COMPETITIONS).order_by('-name'))
		if season_leagues:
			matchups = list(
				SeasonMatchup.objects.select_related(
					'home_team__team', 'away_team__team',
				).filter(season__in=season_leagues)
			)
			for m in matchups:
				if not m.kickoff:
					continue
				meta = competition_meta(m.season.competition)
				rows.append({
					'id': f'sm-{m.id}',
					'season_id': m.season_id,
					'competition': meta['label'],
					'competition_emblem': meta['emblem_url'],
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
					'closed': _kickoff_closed(m.kickoff),
					'status': m.status,
				})
		try:
			active_leagues = list(League.objects.filter(is_active=True).exclude(code='CL'))
			if active_leagues:
				league_matches = list(
					LeagueMatch.objects.select_related('league')
					.filter(league__in=active_leagues, kickoff__isnull=False)
				)
				for m in league_matches:
					rows.append({
						'id': f'lm-{m.match_id}',
						'season_id': None,
						'league_id': m.league_id,
						'competition': m.league.name,
						'competition_emblem': m.league.emblem_url or None,
						'openable': True,
						'home_team': {
							'name': m.home_name,
							'short_name': m.home_short,
							'logo_url': m.home_crest,
						},
						'away_team': {
							'name': m.away_name,
							'short_name': m.away_short,
							'logo_url': m.away_crest,
						},
						'matchday': m.matchday,
						'kickoff': m.kickoff.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
						'result': (
							{'home_goals': m.home_goals, 'away_goals': m.away_goals}
							if m.status == 'FINISHED' and m.home_goals is not None and m.away_goals is not None
							else None
						),
						'closed': _kickoff_closed(m.kickoff),
						'status': m.status,
					})
		except Exception:
			pass
		rows.sort(key=lambda r: r['kickoff'] or '')
		return Response({'matchups': rows})
