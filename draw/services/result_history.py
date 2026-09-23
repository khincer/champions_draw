from django.db.models import Max, Subquery

from ..models import ResultHistory


def record_result_history(observations, *, source, competition, season_name=''):
    """Append one history row per subject whose observed tuple changed.

    ``observations`` are dicts of ``subject, home_label, away_label,
    home_goals, away_goals, status``. Duplicate subjects within one call
    collapse to the last one seen: a directed pair can recur across filters in
    a single run and the live row ends on the last value.

    The comparison is against **history**, not the live row. That is what lets a
    caller which collects its observations **unconditionally** re-detect and
    append a transition whose flush was missed: the next run re-offers the same
    tuple, this helper sees history lacks it, and appends it. A caller that gates
    collection on the live row does not get that property.

    Returns the number of rows appended.

    ponytail: append-only with no pruning. Roughly 10k rows/season is trivial
    for Postgres; a prune management command is the upgrade path if volume
    ever matters.
    """
    latest_by_subject = {}
    for observation in observations:
        latest_by_subject[observation['subject']] = observation

    if not latest_by_subject:
        return 0

    # One bounded prefetch: the latest history row id per subject. The
    # ``order_by()`` here is defensive hygiene, not a correctness requirement:
    # on this Django version SQLCompiler.get_group_by already excludes
    # ``Meta.ordering`` from the GROUP BY — it adds ordering expressions only
    # when ``self._meta_ordering`` is unset, and the compiler sets that flag for
    # ``Meta.ordering`` alone (an explicit ``order_by()`` leaves it unset, so an
    # explicit ordering is the case that would leak). Kept so the aggregate
    # stays correct if that compiler behaviour ever changes. No DISTINCT ON — it
    # is not portable to the SQLite test database.
    latest_ids = (
        ResultHistory.objects
        .filter(source=source, subject__in=list(latest_by_subject))
        .order_by()
        .values('subject')
        .annotate(latest_id=Max('id'))
        .values_list('latest_id', flat=True)
    )
    recorded = {
        row.subject: (row.home_goals, row.away_goals, row.status)
        for row in ResultHistory.objects.filter(id__in=Subquery(latest_ids))
    }

    rows = []
    for subject, observation in latest_by_subject.items():
        observed = (
            observation['home_goals'],
            observation['away_goals'],
            observation['status'],
        )
        if recorded.get(subject) == observed:
            continue
        rows.append(ResultHistory(
            source=source,
            competition=competition,
            season_name=season_name,
            subject=subject,
            home_label=observation['home_label'],
            away_label=observation['away_label'],
            home_goals=observation['home_goals'],
            away_goals=observation['away_goals'],
            status=observation['status'],
        ))

    if not rows:
        return 0

    ResultHistory.objects.bulk_create(rows)
    return len(rows)
