from rest_framework import serializers

from .models import Association, Season, SeasonDraw, SeasonMatchup, SeasonTeam, Team


class AssociationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Association
        fields = ['id', 'name', 'code']


class TeamSerializer(serializers.ModelSerializer):
    association = AssociationSerializer(read_only=True)

    class Meta:
        model = Team
        fields = ['id', 'name', 'short_name', 'association']


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
            'draw_seed',
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
    association = AssociationSerializer(source='team.association', read_only=True)

    class Meta:
        model = SeasonTeam
        fields = [
            'id',
            'team_id',
            'name',
            'short_name',
            'association',
            'uefa_club_coefficient',
            'is_title_holder',
            'qualified_via',
            'seeding_position',
            'pot',
        ]


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
        ]
