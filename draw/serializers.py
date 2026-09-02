import re
import unicodedata

from django.db.models import Max
from rest_framework import serializers

from .models import Association, LeagueStanding, Season, SeasonDraw, SeasonMatchup, SeasonTeam, Team


def _normalize_team_name(name):
    """Lowercase, strip accents + combining marks, drop non-alphanumerics.

    Used for best-effort joins between Team.name (e.g. 'Brugge') and
    LeagueStanding.team_name (e.g. 'Club Brugge KV').
    """
    if not name:
        return ''
    decomposed = unicodedata.normalize('NFD', str(name))
    without_marks = ''.join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r'[^a-z0-9]', '', without_marks.lower())


class AssociationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Association
        fields = ['id', 'name', 'code']


class TeamSerializer(serializers.ModelSerializer):
    association = AssociationSerializer(read_only=True)

    class Meta:
        model = Team
        fields = ['id', 'name', 'short_name', 'logo_url', 'association']


class SeasonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Season
        fields = [
            'id',
            'name',
            'competition',
            'is_active',
            'pot_count',
            'teams_per_pot',
            'total_matches',
        ]


class SeasonTeamSerializer(serializers.ModelSerializer):
    season = SeasonSerializer(read_only=True)
    team = TeamSerializer(read_only=True)

    class Meta:
        model = SeasonTeam
        fields = [
            'id',
            'season',
            'team',
            'uefa_club_coefficient',
            'is_title_holder',
            'qualified_via',
            'domestic_position',
            'seeding_position',
            'pot',
        ]


class SeasonDrawSerializer(serializers.ModelSerializer):
    season = SeasonSerializer(read_only=True)

    class Meta:
        model = SeasonDraw
        fields = [
            'id',
            'season',
            'method',
            'draw_seed',
            'player_name',
            'status',
            'matchups_created',
            'error_message',
            'created_at',
            'completed_at',
        ]


class CompactSeasonTeamSerializer(serializers.ModelSerializer):
    team_id = serializers.IntegerField(source='team.id', read_only=True)
    name = serializers.CharField(source='team.name', read_only=True)
    short_name = serializers.CharField(source='team.short_name', read_only=True)
    logo_url = serializers.URLField(source='team.logo_url', read_only=True)
    association = AssociationSerializer(source='team.association', read_only=True)
    domestic = serializers.SerializerMethodField()

    class Meta:
        model = SeasonTeam
        fields = [
            'id',
            'team_id',
            'name',
            'short_name',
            'logo_url',
            'association',
            'domestic',
            'uefa_club_coefficient',
            'is_title_holder',
            'qualified_via',
            'domestic_position',
            'seeding_position',
            'pot',
        ]

    def _domestic_rows(self):
        """{(country_lower, season_year): [LeagueStanding, ...]} for the latest synced year per league.

        Built once per serializer instance (reused across a many=True list) so
        the join is a single pair of read-only queries, not an N+1.
        """
        if not hasattr(self, '_domestic_rows_cache'):
            max_year_by_league = {
                entry['league']: entry['max_year']
                for entry in LeagueStanding.objects.values('league').annotate(max_year=Max('season_year'))
            }
            cache = {}
            if max_year_by_league:
                rows = LeagueStanding.objects.filter(
                    league_id__in=max_year_by_league
                ).select_related('league')
                for row in rows:
                    if row.season_year != max_year_by_league.get(row.league_id):
                        continue
                    key = (row.league.country.lower(), row.season_year)
                    cache.setdefault(key, []).append(row)
            self._domestic_rows_cache = cache
        return self._domestic_rows_cache

    def get_domestic(self, obj):
        association = obj.team.association
        if not association:
            return None
        country = association.name.lower()
        rows_by_key = self._domestic_rows()
        years = [year for (c, year) in rows_by_key if c == country]
        if not years:
            return None
        latest_year = max(years)
        rows = rows_by_key.get((country, latest_year), [])
        team_norm = _normalize_team_name(obj.team.name)
        for row in rows:
            if _normalize_team_name(row.team_name) == team_norm:
                return self._domestic_payload(row)
        for row in rows:  # fuzzy fallback: 'clubbrugge' == 'clubbruggekv'
            row_norm = _normalize_team_name(row.team_name)
            if (
                row_norm.startswith(team_norm)
                or row_norm.endswith(team_norm)
                or team_norm.startswith(row_norm)
                or team_norm.endswith(row_norm)
            ):
                return self._domestic_payload(row)
        return None

    @staticmethod
    def _domestic_payload(row):
        return {
            'position': row.position,
            'played': row.played,
            'goals_for': row.goals_for,
            'goals_against': row.goals_against,
            'goal_difference': row.goal_difference,
        }


class CompactSeasonMatchupSerializer(serializers.ModelSerializer):
    home_team = CompactSeasonTeamSerializer(read_only=True)
    away_team = CompactSeasonTeamSerializer(read_only=True)

    class Meta:
        model = SeasonMatchup
        fields = [
            'id',
            'home_team',
            'away_team',
            'matchday',
            'home_goals',
            'away_goals',
            'status',
            'kickoff',
        ]


class SeasonMatchupSerializer(serializers.ModelSerializer):
    season = SeasonSerializer(read_only=True)
    home_team = SeasonTeamSerializer(read_only=True)
    away_team = SeasonTeamSerializer(read_only=True)

    class Meta:
        model = SeasonMatchup
        fields = [
            'id',
            'season',
            'home_team',
            'away_team',
            'matchday',
            'home_goals',
            'away_goals',
            'status',
            'kickoff',
        ]
