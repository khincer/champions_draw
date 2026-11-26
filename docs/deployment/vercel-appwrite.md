# Stage Champions Draw on Vercel and Appwrite

Vercel serves the static Preact frontend. Appwrite runs Django and the two sync jobs. PostgreSQL remains the source of truth for users, leagues, fixtures, predictions, and Django sessions. The Railway Docker deployment remains available until the new release passes staging.

## 1. Prepare the staging database

Provision a separate PostgreSQL database accessible from the Appwrite region. Use representative fixtures and synthetic accounts; do not give staging the production database URL. Configure TLS per the database provider. Set Django's secrets in the Appwrite environment, not in Git, in frontend variables, or in build logs.

From an operator environment with the release code, Python dependencies, and **staging-only** Django settings loaded, run:

```sh
python manage.py migrate --noinput
python manage.py bootstrap_season
python manage.py check --deploy
```

Review warnings in the context of the Vercel proxy and track any unresolved warnings before cutover. The management commands are explicit release operations; the API and scheduled functions do not run them automatically.

## 2. Create the Appwrite staging functions

Use Python 3.13, repository root as the function root, and `pip install -r requirements.txt` as the build command. Disable automatic production deployment from Git. Deploy the same source revision to all three functions.

| Function | Entrypoint | Access |
| --- | --- | --- |
| Django API | `deploy/appwrite/django_http.py` | HTTP function domain; Django enforces API permissions and CSRF |
| League data sync | `deploy/appwrite/sync_leagues.py` | No public execute role; leave the schedule off initially |
| Fixture results sync | `deploy/appwrite/sync_results.py` | No public execute role; leave the schedule off initially |

Set `DATABASE_URL`, `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, and `DJANGO_ALLOWED_HOSTS` for each function. Leave `DJANGO_SETTINGS_MODULE` unset so the entrypoints use their Appwrite-specific settings. Use explicit allowed hosts, not `*`. On the API, set `DJANGO_CSRF_TRUSTED_ORIGINS` to the exact trusted HTTPS Vercel origins. Apply the existing feed credentials to the scheduled functions as needed. Do not put a public execution role on either sync function. Before adding a recurring schedule, verify that an unauthenticated HTTP request cannot invoke a sync.

On **staging only**, schedule one execution of each job with the league data job first. Verify each job reaches a successful exit, makes the intended writes, and fits its execution timeout. Disable the staging schedules after verification.

## 3. Deploy a Vercel Preview

Create a Vercel project rooted at the repository root. Set the **Preview** environment variable `APPWRITE_API_ORIGIN` to the HTTPS domain of the staging API function, without an `/api` suffix. The deployment config sets the build and output directory. Do not set a production API origin until cutover is approved.

Local checks before creating the preview:

```sh
npm test
npm run build
npm exec -- vite build --config vite.vercel.config.mjs
python manage.py test
python manage.py test deploy.appwrite.tests.django_integration
```

For native HTTP response tests, run `python -m unittest discover -s deploy/appwrite/tests -v` in an Appwrite-runtime equivalent environment or a local test environment with `aiohttp` installed. The Appwrite Python runtime supplies that dependency.

## 4. Verify the deployment boundary

Use a fresh browser session on the Vercel preview. Record the source commit, Appwrite deployment IDs, database environment, and outcomes:

- Direct links to `/league-manager/` and a shared league open on Vercel. Share responses are not cached or indexed; a guest cannot edit.
- API responses are JSON, including errors, and are not replaced by the HTML page.
- Account bootstrap sets the CSRF cookie. Login persists after reload, logout invalidates the session, and unsafe requests without CSRF fail.
- Before making owner registration public, prove that login and registration limits hold across function instances without treating an untrusted forwarded address as a client identity. The existing default cache is process-local; configure a shared or edge limit if staging reveals that requests can evade the limit by reaching another instance.
- Create a staging league, generate matchdays, record and clear a score, and check that the standings update.
- Save a prediction and generate a representative Champions League draw. Measure the slowest run including a cold request. Appwrite function-domain HTTP calls must complete in under 60 seconds; a borderline or timed-out draw blocks cutover.
- Confirm both scheduled jobs completed on staging and neither can be executed by unauthenticated callers.

## 5. Cut over only after approval

1. Record the current production release and scheduler settings. Take a PostgreSQL backup and prove that it restores to a separate database.
2. Verify migrations are compatible with the currently running production version before using the same database for both releases.
3. Disable the old schedulers before enabling the new ones; do not run both against production. Activate the verified backend and frontend revisions only during the agreed release window.
4. Run the same smoke tests on the production origin using designated test data. If they fail, disable the new schedules, route traffic back to the previous release, and then re-enable the previous schedules. A database restore requires a separate data recovery decision because it can discard writes.

References: [Appwrite Git deployments](https://appwrite.io/docs/products/functions/deploy-from-git), [execution limits and scheduling](https://appwrite.io/docs/products/functions/execute), [Vercel external rewrites](https://vercel.com/docs/routing/rewrites).
