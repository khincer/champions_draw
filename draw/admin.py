from django.contrib import admin

from .models import Association, Season, SeasonDraw, SeasonMatchup, SeasonTeam, Team


@admin.register(Association)
class AssociationAdmin(admin.ModelAdmin):
	list_display = ('name', 'code')
	search_fields = ('name', 'code')


@admin.register(Season)
class SeasonAdmin(admin.ModelAdmin):
	list_display = ('name', 'competition', 'is_active', 'pot_count', 'teams_per_pot')
	list_filter = ('competition', 'is_active')
	search_fields = ('name',)


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
	list_display = ('name', 'short_name', 'association', 'logo_url')
	list_filter = ('association',)
	search_fields = ('name', 'short_name', 'logo_url')


@admin.register(SeasonTeam)
class SeasonTeamAdmin(admin.ModelAdmin):
	list_display = (
		'team',
		'season',
		'uefa_club_coefficient',
		'is_title_holder',
		'qualified_via',
		'seeding_position',
		'pot',
	)
	list_filter = ('season', 'pot', 'is_title_holder', 'qualified_via', 'team__association')
	search_fields = ('team__name', 'team__short_name', 'season__name')


@admin.register(SeasonDraw)
class SeasonDrawAdmin(admin.ModelAdmin):
	list_display = ('season', 'draw_seed', 'player_name', 'status', 'matchups_created', 'created_at', 'completed_at')
	list_filter = ('season', 'status')
	search_fields = ('season__name', 'draw_seed', 'player_name', 'error_message')
	readonly_fields = ('created_at', 'completed_at')


@admin.register(SeasonMatchup)
class SeasonMatchupAdmin(admin.ModelAdmin):
	list_display = ('season', 'home_team', 'away_team', 'matchday')
	list_filter = ('season', 'matchday')
	search_fields = (
		'season__name',
		'home_team__team__name',
		'away_team__team__name',
	)
