# League Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Ship owner-managed single round-robin leagues with saved results, live standings after saves, and a read-only share link.

**Architecture:** The Django app stores leagues, teams, and fixtures independently of imported leagues and predictions. Django computes standings from persisted scores. A dedicated Preact view reads the same fixture and standings payload for owners and guests, with editing actions available only to owners.

**Tech stack:** Django, Django REST Framework, Preact, existing i18n and theme primitives.

**Spec:** [Approved design](../specs/2026-11-25-league-manager-design.md).

## Global constraints

- Keep the existing simulator, official leagues, and anonymous prediction APIs working as they do now.
- Support 2 to 36 teams; every pair plays once. No dates, return legs, playoffs, or co-admins.
- Authenticate owners with Django sessions. Guests use a separate opaque share ID; a share ID never grants write access.
- Retain fixture identities and stored results across repeated generation requests. Only generated leagues can be viewed via share links.
- No new dependencies. Keep test data isolated, and isolate feature work from existing uncommitted audit and localization edits without resetting or stashing them.

## Contract

| Operation | API under `/api/league-manager/` | Notes |
| --- | --- | --- |
| Account | `GET account/`; `POST account/register/`, `account/login/`, `account/logout/` | Username and password for registration/login. GET initializes CSRF for the client and returns the current username or null. Never return credentials. |
| League collection | `GET leagues/`, `POST leagues/` | Owner-only collection. Create with `name` and `team_names`. |
| League detail / edit draft | `GET leagues/<id>/`, `PUT leagues/<id>/teams/` | Replace the complete team list before generation; otherwise return a conflict without changing data. |
| Schedule | `POST leagues/<id>/generate/` | Generate on first valid request; return the persisted schedule on subsequent requests. |
| Result | `PUT leagues/<id>/fixtures/<fixture-id>/result/` | Require both `home_goals` and `away_goals`, either bounded nonnegative integers or both null. Return refreshed league detail. |
| Share | `GET shared/<uuid>/` | Read-only. Missing, malformed and draft links expose no private data. |

League detail exposes `name`, `teams`, `fixtures`, and `standings`. Each fixture exposes `id`, `matchday`, `home_team_id`, `away_team_id`, and the nullable goals. Owner detail additionally exposes league ID, published state, and a share ID only after generation. Browser routes: `/league-manager/` and `/league-manager/share/<uuid>/`.

## Review focus

| Failure mode | Required test |
| --- | --- |
| Case/whitespace duplicates or odd team counts | Reject equivalent names; verify 5 teams produce 5 rounds, 10 fixtures, and one bye each. |
| Partial or falsy score | Reject one null goal or negative input; accept 0–0, then edit and clear it and verify points and played counts. |
| Cross-league management | Owner A cannot update owner B's league; even owner A cannot write fixture B through league A's URL. |
| Login protection and share isolation | A real-CSRF Django client must reject an unsafe request without the token; a valid token still does not make a signed-out guest an owner. |
| Retrying generation or opening a direct share URL | Repeated generation retains scored fixture IDs. Refreshing a published link works signed out and never shows edit controls. |

## Task 1: Pure schedule and standings

**Files:** `draw/services/league_manager.py`, `draw/test_league_manager_rules.py`.

- [ ] Add tests for ordered rounds with 2, 4, 5, and 36 teams: unique pairs, unordered pair coverage, at most one appearance per team in a round, and one bye per team for odd counts. Test standings for unplayed fixtures, 0–0, wins, goal difference, and competition ranks 1, 1, 3 on exact ties.
- [ ] Confirm red with `manage.py test draw.test_league_manager_rules`.
- [ ] Implement `round_robin(team_ids)` returning matchday/home/away triples using circle rotation with a bye placeholder for odd counts. Implement `managed_standings(teams, fixtures)` over explicit team IDs and persisted goals. Return records with team ID/name, numeric rank, played, wins, draws, losses, goals for/against, difference and points.
- [ ] Rerun the focused suite and keep these tests with the rules.

## Task 2: Persistence, accounts and API

**Files:** `draw/models.py`, a migration in `draw/migrations/`, `draw/league_manager_views.py`, `draw/league_manager_serializers.py`, `draw/league_manager_urls.py`, `draw/urls.py`, `draw/test_league_manager_api.py`.

- [ ] Write API tests for the contract, owner and guest isolation, CSRF with checks enabled, duplicate teams, locked roster, durable/idempotent generation, and score correction/clear. Verify the new routes fail before building them.
- [ ] Add `ManagedLeague`, `ManagedLeagueTeam`, and `ManagedLeagueFixture`. Use owner FK, random unique share ID, generation timestamp, bounded name fields, and constraints including a distinct, canonical unordered pair per league and both-null or valid score pairs. Reject cross-league references in the server write path; never accept team IDs from the client during generation.
- [ ] Implement account routes using Django password validation and session APIs. Protect registration and login even for anonymous requests, keep session protections on owner writes, and rate-limit repeated account attempts. Scope each owner queryset and fixture lookup to the authenticated owner and parent league. Generate under a transaction with a league lock; serialize results with fresh derived standings.
- [ ] Run `manage.py test draw.test_league_manager_rules draw.test_league_manager_api` and `manage.py makemigrations --check --dry-run`. Verify a fresh test database creates the tables from migrations.

## Task 3: Owner and shared screens

**Files:** `champions_draw/urls.py`, `frontend/src/main.jsx`, `frontend/src/views/LeagueManager.jsx`, desktop and mobile navigation, `StandingsTable.jsx`, scoped styles, locale keys and catalogs.

- [ ] Record failing browser checks for signed-out direct share and authenticated edit session. Add tests for view helpers and new locale keys where appropriate.
- [ ] Serve the SPA shell at both browser routes. Link to League Manager from the existing navigation. Keep signed-out visitors to the share route out of owner-only screens and forms.
- [ ] Build labeled account and roster forms, schedule generation, matchday browsing with bye information, and per-fixture result editing, clearing and error feedback. Include loading, empty and unavailable states. Reuse the table with full unbanded stats. Keep score actions and share-link feedback keyboard accessible, and verify that table scrolling stays within its section on narrow screens.
- [ ] Run `npm.cmd test`, `npm.cmd run build`, and local desktop and 320 px browser tests against an isolated database. Verify sign-in, create and generate, save 0–0, correct and clear, fresh signed-out share, guest rejection on write, and refresh. Finish with the full Django suite and migration check. No deploy as part of this plan.
