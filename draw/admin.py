from django.contrib import admin

from .models import Association, Season, SeasonTeam, Team


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
	list_display = ('name', 'short_name', 'association')
	list_filter = ('association',)
	search_fields = ('name', 'short_name')


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
