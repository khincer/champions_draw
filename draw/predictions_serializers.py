from rest_framework import serializers

from .models import KnockoutPrediction, MatchPrediction, PlayoffPrediction, Prediction
from .serializers import CompactSeasonMatchupSerializer, CompactSeasonTeamSerializer


class MatchPredictionSerializer(serializers.ModelSerializer):
    matchup = CompactSeasonMatchupSerializer(read_only=True)

    class Meta:
        model = MatchPrediction
        fields = ['id', 'matchup', 'home_goals', 'away_goals']


class MatchPredictionWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = MatchPrediction
        fields = ['matchup', 'home_goals', 'away_goals']


class PlayoffPredictionSerializer(serializers.ModelSerializer):
    home_team = CompactSeasonTeamSerializer(read_only=True)
    away_team = CompactSeasonTeamSerializer(read_only=True)
    winner = CompactSeasonTeamSerializer(read_only=True)

    class Meta:
        model = PlayoffPrediction
        fields = [
            'id', 'matchup_index', 'home_team', 'away_team',
            'leg1_home_goals', 'leg1_away_goals',
            'leg2_home_goals', 'leg2_away_goals',
            'extra_time', 'penalties',
            'et_home_goals', 'et_away_goals',
            'pen_home_goals', 'pen_away_goals',
            'winner',
        ]


class PlayoffPredictionWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlayoffPrediction
        fields = [
            'matchup_index', 'home_team', 'away_team',
            'leg1_home_goals', 'leg1_away_goals',
            'leg2_home_goals', 'leg2_away_goals',
            'extra_time', 'penalties',
            'et_home_goals', 'et_away_goals',
            'pen_home_goals', 'pen_away_goals',
        ]


class KnockoutPredictionSerializer(serializers.ModelSerializer):
    home_team = CompactSeasonTeamSerializer(read_only=True)
    away_team = CompactSeasonTeamSerializer(read_only=True)
    winner = CompactSeasonTeamSerializer(read_only=True)

    class Meta:
        model = KnockoutPrediction
        fields = [
            'id', 'round', 'bracket_position', 'home_team', 'away_team',
            'home_goals', 'away_goals', 'extra_time', 'penalties',
            'et_home_goals', 'et_away_goals',
            'pen_home_goals', 'pen_away_goals',
            'winner',
            'round_label',
        ]
        extra_kwargs = {
            'round_label': {'source': 'get_round_display'},
        }


class KnockoutPredictionWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = KnockoutPrediction
        fields = [
            'round', 'bracket_position', 'home_team', 'away_team',
            'home_goals', 'away_goals', 'extra_time', 'penalties',
            'et_home_goals', 'et_away_goals',
            'pen_home_goals', 'pen_away_goals',
        ]


class PredictionSerializer(serializers.ModelSerializer):
    match_predictions = MatchPredictionSerializer(many=True, read_only=True)
    playoff_predictions = PlayoffPredictionSerializer(many=True, read_only=True)
    knockout_predictions = KnockoutPredictionSerializer(many=True, read_only=True)

    class Meta:
        model = Prediction
        fields = [
            'id', 'season', 'player_name',
            'is_league_complete', 'is_playoffs_complete', 'is_knockout_complete',
            'match_predictions', 'playoff_predictions', 'knockout_predictions',
            'created_at', 'updated_at',
        ]


class PredictionWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Prediction
        fields = ['season', 'player_name']

    def create(self, validated_data):
        prediction, _ = Prediction.objects.get_or_create(
            season=validated_data['season'],
            player_name=validated_data['player_name'],
            defaults=validated_data,
        )
        return prediction
