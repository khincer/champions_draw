# League Manager: single round robin

**Status:** Approved.

League owners can create a league, enter teams, generate matchdays, and record actual results. Participants can follow fixtures and standings through a link without signing in.

## Owner workflow

1. Create an owner account or sign in. The League Manager entry lists only leagues owned by that account.
2. Name the league and enter 2 to 36 team names. Trim names and reject blank or case-insensitive duplicate names. Teams are local to this league and do not modify the official club catalog.
3. Generate the schedule. Every pair plays once, with at most one fixture per team per matchday. An odd number of teams gives one bye per matchday, with each team receiving one bye. No calendar dates are required.
4. Enter, correct, or clear a result. Save both goals together as nonnegative whole numbers; an unplayed fixture has no score. Recompute the standings after the saved change. A 0–0 draw is a played match.
5. Copy the read-only link. Anyone with it can see the generated fixture list, results, and standings. There is no public league directory; the link can be forwarded and is not an access list.

The team list locks when the schedule is generated. Retrying generation returns the existing schedule without changing fixture IDs or results. To change the team list after generation, create a new league. The first version does not delete leagues or regenerate published schedules.

## Standings

Show rank, team, played, wins, draws, losses, goals for, goals against, goal difference, and points. A win is worth 3 points, a draw 1, and a loss 0. Order by points, goal difference, then goals scored. Teams still tied share the same rank, with team name used only to display tied rows in a stable order. Include teams that have not played; exclude unscored fixtures and byes from played totals. No Champions League qualification bands.

## Approach

Use the existing Django and Preact app. Keep managed leagues, teams, and fixtures in separate database records rather than reusing provider-imported leagues or anonymous predictions. Reuse fixture and standings presentation where appropriate, without carrying over competition-specific rules or anonymous write access.

| Approach | Tradeoff |
| --- | --- |
| **Owner account and separate read-only link (selected)** | Requires sign-in, but ownership survives device changes and sharing cannot grant editing rights. |
| Secret edit link plus view link | Avoids sign-in, but anyone who obtains the edit link can change results, and losing the link can mean losing access. |

Use Django account and session authentication for owner actions, with registration, sign-in, and sign-out. Protect state-changing session requests against CSRF; never accept a player display name as proof of ownership. Password reset email and account recovery are outside this first version.

## Data and access

- A managed league belongs to one Django user. Each managed team and fixture belongs to that league. Store the generated matchday, home and away teams, and nullable score pair on each fixture. Enforce same-league teams and unique fixture pairings. Treat league ownership as fixed.
- Owner endpoints require a signed-in owner. A different signed-in user cannot retrieve or mutate private data, even with a known league or fixture ID. The read-only link uses a separate random identifier; it exposes no account details, drafts, edit actions, or owner API permissions.
- Generate the schedule in one transaction under a league lock. Score saves update one fixture atomically. Derive standings on the server from stored results instead of persisting a second copy of the table.
- Serve the share link directly so it works on refresh and in a clean browser session. Show an unavailable state for missing or ungenerated shares. Do not confuse a failed fetch with an empty schedule.

## Acceptance checks

- For both even and odd team counts, verify every pair plays exactly once, no team plays twice in a round, and odd counts give exactly one bye per team.
- Verify 0–0, corrected scores, cleared scores, goal difference, and tied ranks against server standings.
- Two owners and a signed-out visitor demonstrate that only the owner can create or update their league's fixtures and scores; a share link cannot be used to write.
- Repeated generation preserves fixture IDs and scores. A fixture from a different league cannot be updated through the wrong league.
- On mobile and desktop, verify account sign-in, league creation, matchday browsing, score editing, and opening the share link while signed out. Existing draw and prediction flows must remain unchanged.

## Out of scope

Return legs, playoffs, automatic dates, co-admins, roster imports, club logos, and public discovery. No date or availability constraints beyond one match per team per matchday.
