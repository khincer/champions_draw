from django.core.exceptions import ValidationError
from django.db import models


class CompetitionChoices(models.TextChoices):
	CHAMPIONS_LEAGUE = 'UCL', 'UEFA Champions League'


class QualifiedViaChoices(models.TextChoices):
	TITLE_HOLDER = 'TITLE_HOLDER', 'Title holder'
	LEAGUE_POSITION = 'LEAGUE_POSITION', 'League position'
	EUROPA_LEAGUE = 'EUROPA_LEAGUE', 'Europa League title holder'
	CHAMPIONS_PATH = 'CHAMPIONS_PATH', 'Champions path'
	LEAGUE_PATH = 'LEAGUE_PATH', 'League path'
	PERFORMANCE_SPOT = 'PERFORMANCE_SPOT', 'European performance spot'
	OTHER = 'OTHER', 'Other'


class DrawStatusChoices(models.TextChoices):
	RUNNING = 'RUNNING', 'Running'
	COMPLETED = 'COMPLETED', 'Completed'
	FAILED = 'FAILED', 'Failed'


class DrawMethodChoices(models.TextChoices):
	SAT = 'sat', 'SAT (uniform draws)'
	SEQUENTIAL = 'sequential', 'Sequential (UEFA-style)'


class Association(models.Model):
	name = models.CharField(max_length=100, unique=True)
	code = models.CharField(max_length=3, unique=True)

	class Meta:
		ordering = ['name']

	def __str__(self) -> str:
		return f'{self.name} ({self.code})'


class Season(models.Model):
	name = models.CharField(max_length=20, unique=True)
	competition = models.CharField(
		max_length=10,
		choices=CompetitionChoices.choices,
		default=CompetitionChoices.CHAMPIONS_LEAGUE,
	)
	is_active = models.BooleanField(default=False)
	pot_count = models.PositiveSmallIntegerField(default=4)
	teams_per_pot = models.PositiveSmallIntegerField(default=9)
	total_matches = models.PositiveSmallIntegerField(default=8)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['-name']

	def __str__(self) -> str:
		return f'{self.get_competition_display()} {self.name}'


class Team(models.Model):
	name = models.CharField(max_length=100)
	short_name = models.CharField(max_length=30)
	logo_url = models.URLField(max_length=500, blank=True)
	association = models.ForeignKey(
		Association,
		on_delete=models.PROTECT,
		related_name='teams',
	)

	class Meta:
		ordering = ['name']
		constraints = [
			models.UniqueConstraint(
				fields=['association', 'name'],
				name='unique_team_name_per_association',
			),
		]

	def __str__(self) -> str:
		return self.name


class SeasonTeam(models.Model):
	season = models.ForeignKey(
		Season,
		on_delete=models.CASCADE,
		related_name='entries',
	)
	team = models.ForeignKey(
		Team,
		on_delete=models.CASCADE,
		related_name='season_entries',
	)
	uefa_club_coefficient = models.DecimalField(max_digits=7, decimal_places=3)
	is_title_holder = models.BooleanField(default=False)
	qualified_via = models.CharField(
		max_length=30,
		choices=QualifiedViaChoices.choices,
		default=QualifiedViaChoices.LEAGUE_POSITION,
	)
	seeding_position = models.PositiveSmallIntegerField(null=True, blank=True)
	pot = models.PositiveSmallIntegerField(null=True, blank=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['pot', 'seeding_position', 'team__name']
		constraints = [
			models.UniqueConstraint(
				fields=['season', 'team'],
				name='unique_team_per_season',
			),
		]

	def __str__(self) -> str:
		return f'{self.team.name} - {self.season.name}'


class SeasonDraw(models.Model):
	season = models.ForeignKey(
		Season,
		on_delete=models.CASCADE,
		related_name='draws',
	)
	method = models.CharField(
		max_length=20,
		default=DrawMethodChoices.SAT,
		choices=DrawMethodChoices.choices,
		help_text='Draw generation algorithm: sat (uniform) or sequential (UEFA-style).',
	)
	draw_seed = models.CharField(max_length=100)
	player_name = models.CharField(max_length=80, blank=True)
	status = models.CharField(
		max_length=20,
		choices=DrawStatusChoices.choices,
		default=DrawStatusChoices.RUNNING,
	)
	matchups_created = models.PositiveSmallIntegerField(default=0)
	error_message = models.TextField(blank=True)
	created_at = models.DateTimeField(auto_now_add=True)
	completed_at = models.DateTimeField(null=True, blank=True)

	class Meta:
		ordering = ['-created_at']

	def __str__(self) -> str:
		player = f' by {self.player_name}' if self.player_name else ''
		return f'{self.season.name} draw {self.draw_seed}{player} ({self.status})'


class SeasonMatchupHistory(models.Model):
    """A directed (home, away) cross recorded from a past UCL season.

    Used to enforce the "no 3 consecutive seasons with the same home team"
    rule: if (home, away) already occurred in the two most recent seasons,
    the same directed pairing is blocked for the current draw.
    """
    season_name = models.CharField(max_length=20)
    home_team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name='history_home_matchups',
    )
    away_team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name='history_away_matchups',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['season_name']
        constraints = [
            models.UniqueConstraint(
                fields=['season_name', 'home_team', 'away_team'],
                name='unique_directed_history_per_season',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.season_name}: {self.home_team.name} vs {self.away_team.name}'


class SeasonMatchup(models.Model):
	season = models.ForeignKey(
		Season,
		on_delete=models.CASCADE,
		related_name='matchups',
	)
	home_team = models.ForeignKey(
		SeasonTeam,
		on_delete=models.CASCADE,
		related_name='home_matchups',
	)
	away_team = models.ForeignKey(
		SeasonTeam,
		on_delete=models.CASCADE,
		related_name='away_matchups',
	)
	matchday = models.PositiveSmallIntegerField(null=True, blank=True)
	home_goals = models.PositiveSmallIntegerField(null=True, blank=True)
	away_goals = models.PositiveSmallIntegerField(null=True, blank=True)
	status = models.CharField(
		max_length=20,
		blank=True,
		default='',
		help_text='SCHEDULED, IN_PLAY, FINISHED, etc.',
	)
	external_id = models.CharField(max_length=50, blank=True, default='')
	kickoff = models.DateTimeField(null=True, blank=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['season__name', 'matchday', 'home_team__team__name', 'away_team__team__name']
		constraints = [
			models.UniqueConstraint(
				fields=['season', 'home_team', 'away_team'],
				name='unique_directed_matchup_per_season',
			),
			models.CheckConstraint(
				condition=~models.Q(home_team=models.F('away_team')),
				name='prevent_self_matchup',
			),
		]

	def clean(self) -> None:
		super().clean()

		if self.home_team_id and self.away_team_id and self.home_team_id == self.away_team_id:
			raise ValidationError('A team cannot be matched against itself.')

		if self.season_id and self.home_team_id and self.home_team.season_id != self.season_id:
			raise ValidationError({'home_team': 'Home team must belong to the selected season.'})

		if self.season_id and self.away_team_id and self.away_team.season_id != self.season_id:
			raise ValidationError({'away_team': 'Away team must belong to the selected season.'})

		if self.season_id and self.home_team_id and self.away_team_id:
			reverse_matchup_exists = SeasonMatchup.objects.filter(
				season_id=self.season_id,
				home_team_id=self.away_team_id,
				away_team_id=self.home_team_id,
			).exclude(pk=self.pk).exists()
			if reverse_matchup_exists:
				raise ValidationError('This matchup already exists with the teams reversed.')

	def save(self, *args, **kwargs):
		self.full_clean()
		return super().save(*args, **kwargs)

	def __str__(self) -> str:
		return f'{self.season.name}: {self.home_team.team.name} vs {self.away_team.team.name}'


class Prediction(models.Model):
	season = models.ForeignKey(Season, on_delete=models.CASCADE, related_name='predictions')
	player_name = models.CharField(max_length=80)
	is_league_complete = models.BooleanField(default=False)
	is_playoffs_complete = models.BooleanField(default=False)
	is_knockout_complete = models.BooleanField(default=False)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['-updated_at']
		constraints = [
			models.UniqueConstraint(
				fields=['season', 'player_name'],
				name='unique_prediction_per_player_per_season',
			),
		]

	def __str__(self) -> str:
		return f'{self.player_name} - {self.season.name} prediction'


class MatchPrediction(models.Model):
	prediction = models.ForeignKey(Prediction, on_delete=models.CASCADE, related_name='match_predictions')
	matchup = models.ForeignKey(SeasonMatchup, on_delete=models.CASCADE, related_name='predictions')
	home_goals = models.PositiveSmallIntegerField(null=True, blank=True)
	away_goals = models.PositiveSmallIntegerField(null=True, blank=True)

	class Meta:
		constraints = [
			models.UniqueConstraint(
				fields=['prediction', 'matchup'],
				name='unique_match_prediction',
			),
		]

	def __str__(self) -> str:
		return f'{self.matchup}: {self.home_goals}-{self.away_goals}'


class PlayoffPrediction(models.Model):
	prediction = models.ForeignKey(Prediction, on_delete=models.CASCADE, related_name='playoff_predictions')
	matchup_index = models.PositiveSmallIntegerField()
	home_team = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, related_name='home_playoff_preds')
	away_team = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, related_name='away_playoff_preds')
	leg1_home_goals = models.PositiveSmallIntegerField(null=True, blank=True)
	leg1_away_goals = models.PositiveSmallIntegerField(null=True, blank=True)
	leg2_home_goals = models.PositiveSmallIntegerField(null=True, blank=True)
	leg2_away_goals = models.PositiveSmallIntegerField(null=True, blank=True)
	winner = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, null=True, blank=True, related_name='playoff_wins')

	class Meta:
		constraints = [
			models.UniqueConstraint(
				fields=['prediction', 'matchup_index'],
				name='unique_playoff_prediction',
			),
		]

	def __str__(self) -> str:
		return f'Playoff {self.matchup_index}: {self.home_team} vs {self.away_team}'


class KnockoutPrediction(models.Model):
	ROUND_CHOICES = [
		('R16', 'Round of 16'),
		('QF', 'Quarter-final'),
		('SF', 'Semi-final'),
		('F', 'Final'),
	]
	prediction = models.ForeignKey(Prediction, on_delete=models.CASCADE, related_name='knockout_predictions')
	round = models.CharField(max_length=3, choices=ROUND_CHOICES)
	bracket_position = models.PositiveSmallIntegerField()
	home_team = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, null=True, blank=True, related_name='home_knockout_preds')
	away_team = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, null=True, blank=True, related_name='away_knockout_preds')
	home_goals = models.PositiveSmallIntegerField(null=True, blank=True)
	away_goals = models.PositiveSmallIntegerField(null=True, blank=True)
	extra_time = models.BooleanField(default=False)
	penalties = models.BooleanField(default=False)
	winner = models.ForeignKey(SeasonTeam, on_delete=models.CASCADE, null=True, blank=True, related_name='knockout_wins')

	class Meta:
		constraints = [
			models.UniqueConstraint(
				fields=['prediction', 'round', 'bracket_position'],
				name='unique_knockout_prediction',
			),
		]

	def __str__(self) -> str:
		return f'{self.get_round_display()} #{self.bracket_position}: {self.home_team} vs {self.away_team}'


class League(models.Model):
	"""A real-world league fetched from football-data.org."""
	code = models.CharField(max_length=10, unique=True, help_text='API code, e.g. PL, BL1, CL')
	name = models.CharField(max_length=100)
	country = models.CharField(max_length=100, blank=True, default='')
	emblem_url = models.URLField(max_length=500, blank=True, default='')
	plan = models.CharField(max_length=30, blank=True, default='', help_text='API plan tier (TIER_ONE, etc.)')
	is_active = models.BooleanField(default=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['name']

	def __str__(self) -> str:
		return self.name


class LeagueStanding(models.Model):
	"""A team's position in a league table, synced from football-data.org."""
	league = models.ForeignKey(League, on_delete=models.CASCADE, related_name='standings')
	season_year = models.PositiveSmallIntegerField()
	position = models.PositiveSmallIntegerField()
	team_name = models.CharField(max_length=100)
	team_crest = models.URLField(max_length=500, blank=True, default='')
	played = models.PositiveSmallIntegerField(default=0)
	won = models.PositiveSmallIntegerField(default=0)
	draw = models.PositiveSmallIntegerField(default=0)
	lost = models.PositiveSmallIntegerField(default=0)
	goals_for = models.PositiveSmallIntegerField(default=0)
	goals_against = models.PositiveSmallIntegerField(default=0)
	goal_difference = models.IntegerField(default=0)
	points = models.PositiveSmallIntegerField(default=0)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['league', 'season_year', 'position']
		constraints = [
			models.UniqueConstraint(
				fields=['league', 'season_year', 'team_name'],
				name='unique_team_per_league_season',
			),
		]

	def __str__(self) -> str:
		return f'{self.position}. {self.team_name} ({self.league.code})'
