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
			models.UniqueConstraint(
				fields=['association', 'short_name'],
				name='unique_team_short_name_per_association',
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
