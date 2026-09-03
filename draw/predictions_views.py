from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    KnockoutPrediction,
    MatchPrediction,
    PlayoffPrediction,
    Prediction,
    Season,
    SeasonMatchup,
    SeasonTeam,
)
from .predictions_serializers import (
    KnockoutPredictionSerializer,
    KnockoutPredictionWriteSerializer,
    MatchPredictionSerializer,
    MatchPredictionWriteSerializer,
    PlayoffPredictionSerializer,
    PlayoffPredictionWriteSerializer,
    PredictionSerializer,
    PredictionWriteSerializer,
)
from .serializers import CompactSeasonTeamSerializer
from .services.bracket import generate_knockout_bracket
from .services.playoffs import compute_playoff_winner, generate_playoff_matchups
from .services.standings import compute_standings


class PredictionCreateGetAPIView(APIView):
    def post(self, request):
        season_id = request.data.get('season')
        player_name = request.data.get('player_name', '').strip()
        if not season_id:
            return Response({'detail': 'season is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not player_name:
            return Response({'detail': 'player_name is required'}, status=status.HTTP_400_BAD_REQUEST)

        season = get_object_or_404(Season, pk=season_id)

        prediction, created = Prediction.objects.get_or_create(
            season=season,
            player_name=player_name,
            defaults={'season': season, 'player_name': player_name},
        )

        if created:
            matchups = SeasonMatchup.objects.filter(season=season)
            MatchPrediction.objects.bulk_create(
                [MatchPrediction(prediction=prediction, matchup=m) for m in matchups],
                ignore_conflicts=True,
            )

        serializer = PredictionSerializer(prediction)
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class PredictionDetailAPIView(APIView):
    def get(self, request, pk):
        prediction = get_object_or_404(Prediction, pk=pk)
        serializer = PredictionSerializer(prediction)
        return Response(serializer.data)

    def patch(self, request, pk):
        prediction = get_object_or_404(Prediction, pk=pk)
        if 'is_league_complete' in request.data:
            prediction.is_league_complete = bool(request.data['is_league_complete'])
        if 'is_playoffs_complete' in request.data:
            prediction.is_playoffs_complete = bool(request.data['is_playoffs_complete'])
        if 'is_knockout_complete' in request.data:
            prediction.is_knockout_complete = bool(request.data['is_knockout_complete'])
        prediction.save()
        serializer = PredictionSerializer(prediction)
        return Response(serializer.data)


class MatchPredictionUpdateAPIView(APIView):
    def put(self, request, pk, matchup_pk):
        prediction = get_object_or_404(Prediction, pk=pk)
        matchup = get_object_or_404(SeasonMatchup, pk=matchup_pk)

        mp, _ = MatchPrediction.objects.get_or_create(
            prediction=prediction,
            matchup=matchup,
        )

        serializer = MatchPredictionWriteSerializer(mp, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(MatchPredictionSerializer(mp).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class MatchPredictionBulkSyncAPIView(APIView):
    def post(self, request, pk):
        prediction = get_object_or_404(Prediction, pk=pk)
        predictions_data = request.data.get('predictions', [])

        updated = 0
        for item in predictions_data:
            matchup_id = item.get('matchup')
            if not matchup_id:
                continue
            try:
                mp = MatchPrediction.objects.get(
                    prediction=prediction,
                    matchup_id=matchup_id,
                )
            except MatchPrediction.DoesNotExist:
                continue
            mp.home_goals = item.get('home_goals', mp.home_goals)
            mp.away_goals = item.get('away_goals', mp.away_goals)
            mp.save()
            updated += 1

        return Response({'synced': updated})


class StandingsAPIView(APIView):
    def get(self, request, pk):
        prediction = get_object_or_404(Prediction, pk=pk)
        season = prediction.season

        teams = list(
            SeasonTeam.objects.select_related('team', 'team__association')
            .filter(season=season)
            .order_by('pot', 'seeding_position')
        )

        teams_data = CompactSeasonTeamSerializer(teams, many=True).data

        match_preds = MatchPrediction.objects.filter(
            prediction=prediction,
            home_goals__isnull=False,
            away_goals__isnull=False,
        ).select_related('matchup__home_team__team', 'matchup__away_team__team')

        match_data = [
            {
                'home_team_id': mp.matchup.home_team_id,
                'away_team_id': mp.matchup.away_team_id,
                'home_goals': mp.home_goals,
                'away_goals': mp.away_goals,
            }
            for mp in match_preds
        ]

        standings = compute_standings(teams_data, match_data)
        return Response(standings)


class PlayoffBracketAPIView(APIView):
    def get(self, request, pk):
        prediction = get_object_or_404(Prediction, pk=pk)
        season = prediction.season

        teams = list(
            SeasonTeam.objects.select_related('team', 'team__association')
            .filter(season=season)
            .order_by('pot', 'seeding_position')
        )
        teams_data = CompactSeasonTeamSerializer(teams, many=True).data

        match_preds = MatchPrediction.objects.filter(
            prediction=prediction,
            home_goals__isnull=False,
            away_goals__isnull=False,
        )
        match_data = [
            {
                'home_team_id': mp.matchup.home_team_id,
                'away_team_id': mp.matchup.away_team_id,
                'home_goals': mp.home_goals,
                'away_goals': mp.away_goals,
            }
            for mp in match_preds
        ]

        standings = compute_standings(teams_data, match_data)
        playoff_matchups = generate_playoff_matchups(standings)

        playlist = PlayoffPrediction.objects.filter(prediction=prediction)
        pp_map = {pp.matchup_index: pp for pp in playlist}

        result = []
        for pm in playoff_matchups:
            idx = pm['matchup_index']
            pp = pp_map.get(idx)
            if pp:
                result.append(PlayoffPredictionSerializer(pp).data)
            else:
                result.append({
                    'matchup_index': idx,
                    'home_team': pm['home_team'],
                    'away_team': pm['away_team'],
                    'leg1_home_goals': None,
                    'leg1_away_goals': None,
                    'leg2_home_goals': None,
                    'leg2_away_goals': None,
                    'extra_time': False,
                    'penalties': False,
                    'et_home_goals': None,
                    'et_away_goals': None,
                    'pen_home_goals': None,
                    'pen_away_goals': None,
                    'winner': None,
                })

        return Response(result)


class PlayoffBracketSyncAPIView(APIView):
    def post(self, request, pk):
        prediction = get_object_or_404(Prediction, pk=pk)
        predictions_data = request.data.get('predictions', [])

        updated = []
        for item in predictions_data:
            idx = item.get('matchup_index')
            home_id = item.get('home_team')
            away_id = item.get('away_team')
            if not idx or not home_id or not away_id:
                continue

            pp, _ = PlayoffPrediction.objects.get_or_create(
                prediction=prediction,
                matchup_index=idx,
            )
            pp.home_team_id = home_id
            pp.away_team_id = away_id
            pp.leg1_home_goals = item.get('leg1_home_goals', pp.leg1_home_goals)
            pp.leg1_away_goals = item.get('leg1_away_goals', pp.leg1_away_goals)
            pp.leg2_home_goals = item.get('leg2_home_goals', pp.leg2_home_goals)
            pp.leg2_away_goals = item.get('leg2_away_goals', pp.leg2_away_goals)
            pp.extra_time = item.get('extra_time', pp.extra_time)
            pp.penalties = item.get('penalties', pp.penalties)
            pp.et_home_goals = item.get('et_home_goals', pp.et_home_goals)
            pp.et_away_goals = item.get('et_away_goals', pp.et_away_goals)
            pp.pen_home_goals = item.get('pen_home_goals', pp.pen_home_goals)
            pp.pen_away_goals = item.get('pen_away_goals', pp.pen_away_goals)

            pp.winner_id = compute_playoff_winner(
                pp.leg1_home_goals, pp.leg1_away_goals,
                pp.leg2_home_goals, pp.leg2_away_goals,
                pp.home_team_id, pp.away_team_id,
                pp.et_home_goals, pp.et_away_goals,
                pp.pen_home_goals, pp.pen_away_goals,
            )
            pp.save()
            updated.append(PlayoffPredictionSerializer(pp).data)

        return Response({'synced': len(updated), 'predictions': updated})


class KnockoutBracketAPIView(APIView):
    def get(self, request, pk):
        prediction = get_object_or_404(Prediction, pk=pk)
        season = prediction.season

        teams = list(
            SeasonTeam.objects.select_related('team', 'team__association')
            .filter(season=season)
            .order_by('pot', 'seeding_position')
        )
        teams_data = CompactSeasonTeamSerializer(teams, many=True).data

        match_preds = MatchPrediction.objects.filter(
            prediction=prediction,
            home_goals__isnull=False,
            away_goals__isnull=False,
        )
        match_data = [
            {
                'home_team_id': mp.matchup.home_team_id,
                'away_team_id': mp.matchup.away_team_id,
                'home_goals': mp.home_goals,
                'away_goals': mp.away_goals,
            }
            for mp in match_preds
        ]

        standings = compute_standings(teams_data, match_data)

        playoff_preds = PlayoffPrediction.objects.filter(
            prediction=prediction,
            winner__isnull=False,
        ).select_related('winner__team', 'winner__team__association')

        pw_map = {
            pp.matchup_index: CompactSeasonTeamSerializer(pp.winner).data
            for pp in playoff_preds
            if pp.winner_id
        }

        bracket = generate_knockout_bracket(standings, pw_map)

        knockout_preds = KnockoutPrediction.objects.filter(prediction=prediction)
        kp_map = {}
        for kp in knockout_preds:
            kp_map[(kp.round, kp.bracket_position)] = kp

        def resolve_team(source):
            if source is None:
                return None
            if isinstance(source, dict) and 'team_id' in source:
                return source
            return source

        enriched = {}
        for round_name, matches in bracket.items():
            enriched[round_name] = []
            for m in matches:
                kp = kp_map.get((m['round'], m['bracket_position']))
                if kp:
                    enriched[round_name].append(KnockoutPredictionSerializer(kp).data)
                else:
                    base = dict(m)
                    base.pop('home_source', None)
                    base.pop('away_source', None)
                    # resolve home/away if they are dicts
                    if isinstance(base.get('home_team'), dict) and 'team_id' in base['home_team']:
                        base['home_team'] = base['home_team']
                    elif isinstance(base.get('home_team'), dict):
                        base['home_team'] = base['home_team']
                    base['home_goals'] = None
                    base['away_goals'] = None
                    base['extra_time'] = False
                    base['penalties'] = False
                    base['winner'] = None
                    enriched[round_name].append(base)

        return Response(enriched)
