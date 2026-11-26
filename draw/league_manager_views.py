from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .league_manager_serializers import CreateManagedLeagueSerializer, ManagedResultSerializer, RosterSerializer
from .models import ManagedLeague, ManagedLeagueFixture, ManagedLeagueTeam
from .services.league_manager import MAX_TEAMS, MIN_TEAMS, managed_standings, round_robin


def league_summary(league):
    return {'id': league.pk, 'name': league.name, 'generated': league.generated_at is not None}


def league_detail(league, *, owner=False):
    teams = list(league.teams.values('id', 'name'))
    fixtures = list(league.fixtures.values(
        'id', 'matchday', 'home_team_id', 'away_team_id', 'home_goals', 'away_goals',
    )) if league.generated_at is not None else []
    detail = {
        'name': league.name,
        'teams': teams,
        'fixtures': fixtures,
        'standings': managed_standings(teams, fixtures),
    }
    if owner:
        detail.update(league_summary(league))
        if league.generated_at is not None:
            detail['share_id'] = str(league.share_id)
    return detail


def input_error(serializer, *, code='invalid_teams'):
    errors = serializer.errors
    if 'name' in errors:
        code = 'invalid_league'
    elif any(getattr(error, 'code', None) == 'duplicate_teams' for error in errors.get('team_names', [])):
        code = 'duplicate_teams'
    return Response({'code': code, 'errors': errors}, status=status.HTTP_400_BAD_REQUEST)


def add_teams(league, names):
    ManagedLeagueTeam.objects.bulk_create(
        ManagedLeagueTeam(league=league, name=name) for name in names
    )


@method_decorator(never_cache, name='dispatch')
class ManagedOwnerAPIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def owned_leagues(self, request):
        return ManagedLeague.objects.filter(owner=request.user)

    def owned_league(self, request, league_id, *, lock=False):
        queryset = self.owned_leagues(request)
        if lock:
            queryset = queryset.select_for_update()
        return get_object_or_404(queryset, pk=league_id)


class ManagedLeagueCollectionAPIView(ManagedOwnerAPIView):
    def get(self, request):
        return Response({'leagues': [league_summary(league) for league in self.owned_leagues(request)]})

    @transaction.atomic
    def post(self, request):
        serializer = CreateManagedLeagueSerializer(data=request.data)
        if not serializer.is_valid():
            return input_error(serializer)
        league = ManagedLeague.objects.create(owner=request.user, name=serializer.validated_data['name'])
        add_teams(league, serializer.validated_data['team_names'])
        return Response(league_detail(league, owner=True), status=status.HTTP_201_CREATED)


class ManagedLeagueDetailAPIView(ManagedOwnerAPIView):
    def get(self, request, league_id):
        return Response(league_detail(self.owned_league(request, league_id), owner=True))


class ManagedLeagueRosterAPIView(ManagedOwnerAPIView):
    @transaction.atomic
    def put(self, request, league_id):
        league = self.owned_league(request, league_id, lock=True)
        if league.generated_at is not None:
            return Response({'code': 'roster_locked'}, status=status.HTTP_409_CONFLICT)
        serializer = RosterSerializer(data=request.data)
        if not serializer.is_valid():
            return input_error(serializer)
        league.teams.all().delete()
        add_teams(league, serializer.validated_data['team_names'])
        return Response(league_detail(league, owner=True))


class ManagedLeagueGenerateAPIView(ManagedOwnerAPIView):
    @transaction.atomic
    def post(self, request, league_id):
        league = self.owned_league(request, league_id, lock=True)
        if league.generated_at is None:
            team_ids = list(league.teams.values_list('id', flat=True))
            if not MIN_TEAMS <= len(team_ids) <= MAX_TEAMS:
                return Response({'code': 'invalid_teams'}, status=status.HTTP_400_BAD_REQUEST)
            ManagedLeagueFixture.objects.bulk_create(
                ManagedLeagueFixture(league=league, matchday=matchday, home_team_id=home, away_team_id=away)
                for matchday, home, away in round_robin(team_ids)
            )
            league.generated_at = timezone.now()
            league.save(update_fields=['generated_at'])
        return Response(league_detail(league, owner=True))


class ManagedLeagueResultAPIView(ManagedOwnerAPIView):
    @transaction.atomic
    def put(self, request, league_id, fixture_id):
        league = self.owned_league(request, league_id, lock=True)
        fixture = get_object_or_404(league.fixtures, pk=fixture_id)
        serializer = ManagedResultSerializer(data=request.data)
        if not serializer.is_valid():
            return input_error(serializer, code='invalid_score')
        fixture.home_goals = serializer.validated_data['home_goals']
        fixture.away_goals = serializer.validated_data['away_goals']
        fixture.save(update_fields=['home_goals', 'away_goals'])
        return Response(league_detail(league, owner=True))


@method_decorator(never_cache, name='dispatch')
class SharedManagedLeagueAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, share_id):
        league = get_object_or_404(ManagedLeague, share_id=share_id, generated_at__isnull=False)
        return Response(league_detail(league), headers={'X-Robots-Tag': 'noindex, nofollow'})
