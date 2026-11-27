# Staging infrastructure

Terraform manages three functions in an existing **staging** Appwrite project, a Vercel staging project, and their public configuration. Only the Django API accepts public execution. Both sync functions start without a schedule or event triggers, and Vercel is not connected to Git for automatic deployment.

Terraform does not create PostgreSQL, write application secrets, upload code, run migrations, or change Railway or production. Use the [staging release runbook](../../docs/deployment/vercel-appwrite.md) to deploy and verify the application.

## Validate without credentials

Run from `infra/staging`. Terraform 1.11 or later is required; the provider selections are locked.

```powershell
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform test
```

Provider installation needs network access. The tests use mocked providers and plan operations only; they do not create real resources.

## Prepare a staging plan

1. Use an Appwrite project reserved for staging and a Vercel account or team that can manage the staging project. Set `APPWRITE_ENDPOINT` (including `/v1`), `APPWRITE_API_KEY`, and `VERCEL_API_TOKEN` in the shell from your credential store. The Appwrite key needs only the function access for this project, not organization credentials. Do not put the keys in variable files.
2. Copy `staging.tfvars.example` to `staging.tfvars`. Enter the actual Appwrite staging project ID and a Vercel project name ending in `-staging`. Set `vercel_team` to the team ID or slug if targeting a team.
3. If the API function has no public URL yet, leave `appwrite_api_origin` unset for the first plan. Terraform can create the functions and Vercel project without it; it will not set `APPWRITE_API_ORIGIN` or the Django host list yet. Leave `vercel_staging_origin` unset until you know the exact HTTPS frontend URL.
4. Initialize your staging backend and review the plan. Local state is ignored but stays on disk. For shared work, configure a separate encrypted remote state backend with locking and restricted access before the first apply. Never share state or plan files in Git, CI artifacts, or chat.

```powershell
terraform init
terraform plan -var-file=staging.tfvars -out=staging.tfplan
```

Check the selected Appwrite project, Vercel team, and proposed changes. Do not apply a plan with production resources, replacements, unexpected removals, or public sync permissions. If the plan is approved, apply the saved plan using `terraform apply staging.tfplan`.

## Connect the preview and ship code

1. Obtain the Django function's public HTTPS origin from Appwrite. If Appwrite only shows the domain after a code deployment, upload the tracked release to that staging function first using the runbook; do not route Vercel traffic to it yet. Set `appwrite_api_origin` in `staging.tfvars` to that origin without a path or trailing slash. Review a fresh plan and apply it separately. Terraform sets `APPWRITE_API_ORIGIN` for Vercel Preview only and sets explicit Django allowed hosts for all three functions.
2. Set `DATABASE_URL`, `DJANGO_SECRET_KEY`, and any feed credentials directly in Appwrite. Use a separate staging PostgreSQL database and keep those values out of Terraform; marking an input sensitive would not prevent storage in state. Run migration and season bootstrap from the operator environment, not a function.
3. Use the Appwrite and Vercel CLI release steps in the runbook. Link Vercel to the project identified by `terraform output vercel_project_id`; do not add another environment variable with the same name. Deploy a Vercel **Preview**, set `vercel_staging_origin` to the exact preview URL (or a stable alias you control), and review and apply a fresh plan. Appwrite must be redeployed after this change to trust the frontend origin for CSRF. Verify login, share links, score saving, and sync jobs before considering production.

## Adopt existing staging resources

Import existing resources instead of trying to recreate them. First disable any existing Appwrite cron or interval schedules and remove event triggers from the two sync functions. Confirm the Vercel project has no Git autodeploy link. Review the first post-import plan before applying.

| Terraform address | Import ID |
| --- | --- |
| `appwrite_function.staging["api"]` | `django-api` |
| `appwrite_function.staging["sync_leagues"]` | `sync-leagues` |
| `appwrite_function.staging["sync_results"]` | `sync-results` |
| `appwrite_function_variable.django["<key>"]` | `<function-id>/<variable-id>` |
| `vercel_project.staging` | `<project-id>` with the team configured |
| `vercel_project_environment_variable.api_origin[0]` | `<project-id>/<variable-id>` with the team configured |

Run `terraform import -var-file=staging.tfvars <address> <import-id>` for each existing managed object. Only import Appwrite variables declared in `main.tf`; do not import application secrets. If resources use different function IDs, reconcile the configuration first rather than planning replacements.
