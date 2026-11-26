from rest_framework import serializers

from .services.league_manager import MAX_GOALS, MAX_TEAMS, MIN_TEAMS


class StrictTextField(serializers.CharField):
    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail('invalid')
        return super().to_internal_value(data)


class RosterSerializer(serializers.Serializer):
    team_names = serializers.ListField(
        child=StrictTextField(max_length=80),
        min_length=MIN_TEAMS,
        max_length=MAX_TEAMS,
        allow_empty=False,
    )

    def validate_team_names(self, names):
        if len({name.casefold() for name in names}) != len(names):
            raise serializers.ValidationError('Each team needs a unique name.', code='duplicate_teams')
        return names


class CreateManagedLeagueSerializer(RosterSerializer):
    name = StrictTextField(max_length=100)


class GoalField(serializers.IntegerField):
    def to_internal_value(self, data):
        if type(data) is not int:
            self.fail('invalid')
        return super().to_internal_value(data)


class ManagedResultSerializer(serializers.Serializer):
    home_goals = GoalField(min_value=0, max_value=MAX_GOALS, allow_null=True)
    away_goals = GoalField(min_value=0, max_value=MAX_GOALS, allow_null=True)

    def validate(self, attrs):
        if (attrs['home_goals'] is None) != (attrs['away_goals'] is None):
            raise serializers.ValidationError('Enter both scores or clear both scores.')
        return attrs
