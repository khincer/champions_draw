"""Read-side helpers for the draw app.

Per the HackSoft Django styleguide, reads (queries and the payloads built
from them) belong in a selectors module, not in the view layer.  These
bodies are moved verbatim out of views.py; behaviour is unchanged.
"""

import json
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from rest_framework.exceptions import NotFound

from .management.commands.sync_real_fixture_results import (
	PROMIEDOS_URL,
	fetch,
	fixture_id as real_fixture_id,
)
from .models import (
	InteractiveDrawPick,
	RealFixtureResult,
	Season,
	SeasonDraw,
	SeasonMatchup,
	SeasonTeam,
)
from .serializers import (
	CompactSeasonMatchupSerializer,
	CompactSeasonTeamSerializer,
	SeasonDrawSerializer,
	_normalize_team_name,
)
from .services.interactive_draw import current_pot


def active_season():
	"""The newest active season, or None."""
	return Season.objects.filter(is_active=True).order_by('-name').first()


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


def interactive_state(season: Season, draw: SeasonDraw) -> dict:
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


def load_real_fixtures(season: Season) -> list:
	"""Read the real league-phase fixtures joined to SeasonTeam entries.

	Returns the same payload shape RealSeasonFixturesAPIView serves, so
	prediction sync and the fixtures endpoint agree on ids, teams, and the
	closed computation.
	"""
	data = real_fixtures_json()

	# The checked-in calendar covers exactly one season and names it. Serving it
	# for any other season joins UCL fixtures against another competition's teams,
	# so every lookup misses and the caller 404s with the misleading
	# "Team not found in season: <team>" -- which is what a non-UCL season on the
	# real-draw page used to produce. Refuse rather than guess.
	calendar_season = data.get('season') or {}
	if (season.competition, season.name) != (
		calendar_season.get('competition'),
		calendar_season.get('name'),
	):
		# Not the calendar's season, but it may still have real fixtures of its
		# own: LIB, SUD and UNL carry matchdays and results in SeasonMatchup.
		return _season_matchup_fixtures(season)

	# Live scores come from the DB (Railway's filesystem is ephemeral and not
	# shared across services); the JSON above is only the static calendar.
	db_results = {
		row.fixture_id: {'home_goals': row.home_goals, 'away_goals': row.away_goals}
		for row in RealFixtureResult.objects.all()
	}

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
		fid = real_fixture_id(md, idx)

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
			'id': fid,
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
			# DB result wins; the JSON's static result is the fallback.
			'result': db_results.get(fid) or fixture.get('result'),
			'closed': closed,
		})

	return matchups


def _season_matchup_fixtures(season: Season) -> list:
	"""Real fixtures for a season with no checked-in calendar.

	Same payload shape as the calendar path, so the real-draw page and the
	prediction sync do not care which source a competition came from. LIB, SUD
	and UNL carry real matchdays and results in SeasonMatchup; the friendlies
	season carries no matchday at all, which the UI already handles by grouping
	on a null matchday.
	"""
	rows = (
		SeasonMatchup.objects.select_related(
			'home_team__team', 'home_team__team__association',
			'away_team__team', 'away_team__team__association',
		)
		.filter(season=season)
		.order_by('matchday', 'kickoff', 'pk')
	)

	matchups = []
	for row in rows:
		kickoff = row.kickoff
		if kickoff is not None and kickoff.tzinfo is None:
			kickoff = kickoff.replace(tzinfo=timezone.utc)

		has_result = row.home_goals is not None and row.away_goals is not None
		matchups.append({
			# `sm-` namespaced so it can never collide with the calendar's
			# matchday-indexed ids.
			'id': f'sm-{row.pk}',
			'home_team': CompactSeasonTeamSerializer(row.home_team).data,
			'away_team': CompactSeasonTeamSerializer(row.away_team).data,
			'home_entry': row.home_team,
			'away_entry': row.away_team,
			'matchday': row.matchday,
			'home_goals': None,
			'away_goals': None,
			'status': row.status,
			'kickoff': (
				kickoff.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
				if kickoff is not None else None
			),
			'result': (
				{'home_goals': row.home_goals, 'away_goals': row.away_goals}
				if has_result else None
			),
			'closed': row.status == 'FINISHED',
		})

	return matchups


@lru_cache(maxsize=1)
def real_fixtures_json():
	# Checked-in static calendar, never rewritten at runtime: parse once per
	# process instead of on every poll (real-fixtures, live-scores, homepage
	# each hit this every 30s per viewer).
	fixtures_path = Path(__file__).resolve().parent / 'data' / 'ucl_league_phase_real_fixtures_2026_27.json'
	with open(fixtures_path, 'r', encoding='utf-8') as f:
		return json.load(f)


# Short TTL so several viewers polling every 30s don't each hit promiedos; a
# 15s cache caps upstream traffic at ~4 fetches/min regardless of audience.
_PROMIEDOS_LIVE_CACHE = {'at': 0.0, 'html': None}


def fetch_promiedos_live_html():
	now = time.monotonic()
	cached = _PROMIEDOS_LIVE_CACHE
	if cached['html'] is None or now - cached['at'] > 15:
		cached['html'] = fetch(PROMIEDOS_URL, source='Promiedos')
		cached['at'] = now
	return cached['html']


# football-data reports these before a ball is kicked. Anything else (FINISHED,
# IN_PLAY, POSTPONED, …) is not open for a new pick.
PREDICTABLE_LEAGUE_STATUSES = {'SCHEDULED', 'TIMED'}


def league_fixture_state(match, now):
	"""'open' | 'closed' | 'unscheduled' for prediction writes."""
	if match.kickoff is None:
		return 'unscheduled'
	if match.status not in PREDICTABLE_LEAGUE_STATUSES or match.kickoff <= now:
		return 'closed'
	return 'open'
