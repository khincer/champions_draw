from rest_framework import serializers

from .models import Association, Season, SeasonMatchup, SeasonTeam, Team


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
