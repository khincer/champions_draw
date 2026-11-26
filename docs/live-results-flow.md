# Live Results Flow

How real match results reach the UI. There are **two independent paths** and they
do not call each other:

1. **Write path (cron)** — a Railway cron service pulls results and persists them.
   Triggered by the container entrypoint, not by a request.
2. **Read path (live poll)** — the browser polls an API endpoint that scrapes the
   Promiedos live page on demand. Reads only; never writes.

The two paths meet at the database (`RealFixtureResult` / `SeasonMatchup`), which
the read path loads as its fixture list.

---

## 1. Full flow

```mermaid
flowchart TD
    subgraph TRIGGER["Trigger — Railway cron service"]
        CRON["Railway service<br/>SERVICE_ROLE=cron-results"]
        EP["docker-entrypoint.sh<br/>case branch, set -e"]
        CRON --> EP
    end

    subgraph WRITE["Write path — sync_real_fixture_results"]
        CMD["python manage.py<br/>sync_real_fixture_results<br/>--source promiedos"]
        F1["fetch(PROMIEDOS_URL)<br/>retry x3, backoff 5s/10s"]
        P1["parse_promiedos()<br/>__NEXT_DATA__ -> FINISHED only"]
        F2["fetch(FBREF_URL)"]
        P2["parse_schedule()<br/>_ScheduleParser, HTML"]
        F3["fetch_football_data(KEY)"]
        P3["parse_football_data()<br/>LEAGUE_STAGE + FINISHED"]
        CAL["draw/data/ucl_league_phase_<br/>real_fixtures_2026_27.json<br/>static calendar, READ-ONLY"]
        MR["match_results()<br/>pair by normalized team names"]
        RES["resolve() / normalize()<br/>_ALIASES lookup"]
        RFR["RealFixtureResult<br/>fixture_id real-MD-IDX"]
        ORCH["record_result_history()<br/>dedupe vs latest history row"]
        RH["ResultHistory<br/>append-only"]
    end

    EP --> CMD
    CMD --> F1 --> P1 --> MR
    CMD -. "--source fbref" .-> F2 --> P2 --> MR
    CMD -. "--source football-data" .-> F3 --> P3 --> MR
    CAL --> MR
    MR --> RES
    MR --> RFR
    MR --> ORCH
    RFR --> ORCH
    ORCH --> RH

    subgraph SIBLINGS["Write path — sibling cron-results commands"]
        SPF["sync_promiedos_fixtures<br/>--competition lib / sud"]
        SPN["sync_promiedos_nations_league<br/>--competition unl"]
        SPFR["sync_promiedos_friendlies"]
        SLF["sync_league_fixtures<br/>9 leagues, minutes"]
        SM["SeasonMatchup"]
        LM["LeagueMatch"]
        SPF --> SM
        SPN --> SM
        SPFR --> SM
        SLF --> LM
        SM --> ORCH2["record_result_history()"]
        LM --> ORCH2
        ORCH2 --> RH
    end

    subgraph READ["Read path — shared fixture list"]
        LRF["load_real_fixtures(season)"]
        CAL2["UCL: static calendar<br/>result = DB row wins,<br/>JSON result is fallback"]
        SM2["LIB / SUD / UNL / friendlies:<br/>SeasonMatchup rows<br/>fixture_id sm-PK"]
        LRF --> CAL2
        LRF --> SM2
    end

    RFR --> LRF
    SM --> LRF

    subgraph POLL["Read path — browser live poll"]
        BROWSER["main.jsx pollLive()<br/>every 30s"]
        GUARD{"any fixture<br/>closed AND no result?"}
        URL["GET /api/ui/seasons/PK/live-scores/<br/>draw/urls.py ui-season-live-scores"]
        VIEW["LiveScoresAPIView.get<br/>draw/views.py:363"]
        PURL["promiedos_live_url(competition)<br/>UCL / LIB / SUD / UNL"]
        NONE["friendlies has no live page<br/>-> returns empty live map, 200"]
        FETCH["fetch_promiedos_live_html(url)<br/>15s in-process TTL cache"]
        PLIVE["parse_promiedos_live(html)<br/>IN_PLAY only"]
        RL["resolve_live(name)<br/>_PROMIEDOS_LIVE_ALIASES -> _ALIASES"]
        MAP["map (home, away) -> fixture_id"]
        OK["200 live: fixture_id -><br/>home_goals, away_goals, status"]
        ERR["502 live: empty + error string"]
    end

    BROWSER --> GUARD
    GUARD -- no --> BROWSER
    GUARD -- yes --> URL --> VIEW
    VIEW --> LRF
    VIEW --> PURL
    PURL -- none --> NONE
    PURL -- url --> FETCH --> PLIVE --> MAP
    RL --> MAP
    MAP --> OK
    PLIVE -. failure .-> ERR
    OK --> BROWSER

    subgraph REFRESH["Read path — 60s fixture refresh"]
        RM["loadRealMatches()"]
        RFE["GET /api/ui/seasons/PK/real-fixtures/"]
        RSF["RealSeasonFixturesAPIView.get"]
        RM --> RFE --> RSF --> LRF
        RSF --> FEED["browser: closed flag drives<br/>the 30s poll guard"]
    end
```

---

## 2. Live poll — the actual runtime sequence

This is the path a user triggers by opening the app while a match is in play.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (main.jsx)
    participant D as Django /ui/ API
    participant V as LiveScoresAPIView
    participant S as selectors.py
    participant P as Promiedos

    B->>B: loadRealMatches() every 60s
    B->>D: GET /ui/seasons/{id}/real-fixtures/
    D->>S: load_real_fixtures(season)
    S-->>D: fixtures with closed flag
    D-->>B: matchups + closed

    Note over B: guard: only seasons having a fixture that is<br/>closed AND still has no result
    B->>D: GET /ui/seasons/{id}/live-scores/
    D->>V: LiveScoresAPIView.get
    V->>S: load_real_fixtures(season)
    S-->>V: fixtures, ids real-MD-IDX or sm-PK
    V->>S: promiedos_live_url(competition)
    alt friendlies (no live page)
        S-->>V: None
        V-->>B: 200 {live: {}}
    else UCL / LIB / SUD / UNL
        S-->>V: live page URL
        V->>S: fetch_promiedos_live_html(url)
        Note over S: in-process cache, 15s TTL<br/>absorbes many viewers polling at 30s
        S->>P: GET live page
        P-->>S: HTML
        S-->>V: HTML
        V->>V: parse_promiedos_live(html)
        V->>V: resolve_live() on each side, then map pair -> fixture_id
        Note over V: unmatched pairs are skipped,<br/>not errors
        V-->>B: 200 {live: {fixture_id: {home_goals, away_goals, status}}}
    end

    Note over V: RuntimeError / ValueError / KeyError /<br/>IndexError / JSONDecodeError on the scrape
    V-->>B: 502 {live: {}, error: "..."}
    B->>B: shell.liveScoresUnavailable, retry in 30s

    B->>B: setInterval(pollLive, 30_000)
```

---

## 3. Where the two paths diverge per competition

| Competition | Fixture source (read) | Fixture id | Live page | Cron writer |
|---|---|---|---|---|
| UCL | static calendar JSON + `RealFixtureResult` | `real-{matchday}-{index}` | Promiedos UCL | `sync_real_fixture_results` |
| LIB | `SeasonMatchup` | `sm-{pk}` | Promiedos Libertadores | `sync_promiedos_fixtures --competition lib` |
| SUD | `SeasonMatchup` | `sm-{pk}` | Promiedos Sudamericana | `sync_promiedos_fixtures --competition sud` |
| UNL | `SeasonMatchup` | `sm-{pk}` | Promiedos Nations League | `sync_promiedos_nations_league --competition unl` |
| Friendlies | `SeasonMatchup` | `sm-{pk}` | none — returns empty | `sync_promiedos_friendlies` |
| 9 other leagues | `LeagueMatch` | `lm-{match_id}` | none — `season_id` is null | `sync_league_fixtures` |

---

## 4. Invariants worth not breaking

- **DB result wins over the checked-in JSON.** `load_real_fixtures` sets
  `result = db_results.get(fid) or fixture.get('result')`. Railway's filesystem is
  ephemeral, so the JSON is only the static calendar; a result that only ever
  reached the JSON would vanish on redeploy.
- **`closed` is kickoff-based, not status-based.** Derived as
  `now >= kickoff - 10 minutes`. Deriving it from `FINISHED` made an in-play match
  look open, so the poll never started and live scores never appeared.
- **The live poll is gated on `closed AND no result`.** Without that gate the
  client would hammer Promiedos for competitions that are finished or have no
  live source.
- **Homepage league rows carry `season_id: null` on purpose.** `HomepageMatchesAPIView`
  serves `LeagueMatch` rows as `lm-{match_id}` with a null `season_id`, so the
  client's `.filter(Boolean)` drops them from the live poll. The 9 non-UCL leagues
  are refreshed by the 60s `loadRealMatches` call and the cron, never by the 30s
  live scrape. Setting a real `season_id` on those rows would silently route them
  into the Promiedos live path.
- **`sync_real_fixture_results` reads the fixtures JSON, never writes it.** Its
  contract is `RealFixtureResult` + `ResultHistory` only.
- **`--source promiedos` is the default** because football-data lags on `FINISHED`.
  `football-data` remains available for the live product only via manual run.
- **`set -e` in `docker-entrypoint.sh` is load-bearing.** A failed sync must exit
  non-zero so the cron run is visibly failed rather than silently "succeeding".
- **The `SERVICE_ROLE` case branch exists to fix a real Railway bug.** Railway
  builds the Dockerfile for every service and ignores per-service `startCommand`,
  so one image is branched at runtime. Do not collapse it back to a single `CMD`.

## 5. Known open tension

`docker-entrypoint.sh` records an unresolved placement question: the Nations
League sync lives on the daily `cron-leagues` job even though its *results* change
as fast as the UCL's. The comment says group by change rate, not by the word
"league" — and that a UNL result-refresh path would belong in `cron-results`. The
tension is documented in the script, not resolved.

---

## 6. Rendered output

The Mermaid blocks above are rendered and kept alongside this file:

- `live-results-full-flow.svg` — the full two-path flow (section 1)
- `live-results-poll-sequence.svg` — the live poll sequence (section 2)

Open either in a browser, VS Code, or Obsidian. SVG scales cleanly and stays
editable as text.

### Regenerating

Uses the system Chrome, so Puppeteer does not download its own ~300 MB Chromium:

```powershell
$env:PUPPETEER_SKIP_DOWNLOAD="true"
$env:PUPPETEER_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
npx -y @mermaid-js/mermaid-cli -i docs\live-results-flow.md -o docs\live-results-flow.rendered.md
```

Then rename the numbered outputs, since `mmdc` names them after the input file:

```powershell
Move-Item -Force docs\live-results-flow.rendered-1.svg docs\live-results-full-flow.svg
Move-Item -Force docs\live-results-flow.rendered-2.svg docs\live-results-poll-sequence.svg
Remove-Item -Force docs\live-results-flow.rendered.md
```

The output order matches the order of the ```mermaid blocks in this file.

