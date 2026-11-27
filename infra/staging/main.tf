locals {
  functions = {
    api = {
      id         = "django-api"
      entrypoint = "deploy/appwrite/django_http.py"
      execute    = ["any"]
      timeout    = 60
    }
    sync_leagues = {
      id         = "sync-leagues"
      entrypoint = "deploy/appwrite/sync_leagues.py"
      execute    = []
      timeout    = var.sync_timeout_seconds
    }
    sync_results = {
      id         = "sync-results"
      entrypoint = "deploy/appwrite/sync_results.py"
      execute    = []
      timeout    = var.sync_timeout_seconds
    }
  }

  allowed_hosts = var.appwrite_api_origin == null ? null : join(",", distinct([
    for origin in compact([var.appwrite_api_origin, var.vercel_staging_origin]) : trimprefix(origin, "https://")
  ]))

  django_variables = merge(
    {
      for key in keys(local.functions) : "${key}_debug" => {
        function = key
        key      = "DJANGO_DEBUG"
        value    = "false"
      }
    },
    {
      for key in keys(local.functions) : "${key}_hosts" => {
        function = key
        key      = "DJANGO_ALLOWED_HOSTS"
        value    = local.allowed_hosts
      } if local.allowed_hosts != null
    },
    var.vercel_staging_origin == null ? {} : {
      api_csrf = {
        function = "api"
        key      = "DJANGO_CSRF_TRUSTED_ORIGINS"
        value    = var.vercel_staging_origin
      }
    },
  )
}

resource "appwrite_function" "staging" {
  for_each = local.functions

  id         = each.value.id
  name       = each.value.id
  runtime    = "python-3.13"
  entrypoint = each.value.entrypoint
  commands   = "pip install -r requirements.txt"
  execute    = each.value.execute
  timeout    = each.value.timeout
  schedule   = ""
  events     = []
  scopes     = []

  lifecycle {
    prevent_destroy = true
  }
}

resource "appwrite_function_variable" "django" {
  for_each = local.django_variables

  function_id = appwrite_function.staging[each.value.function].id
  key         = each.value.key
  value       = each.value.value
  secret      = false
}

resource "vercel_project" "staging" {
  name      = var.vercel_project_name
  framework = "vite"

  lifecycle {
    prevent_destroy = true
  }
}

resource "vercel_project_environment_variable" "api_origin" {
  count = var.appwrite_api_origin == null ? 0 : 1

  project_id = vercel_project.staging.id
  key        = "APPWRITE_API_ORIGIN"
  value      = var.appwrite_api_origin
  target     = ["preview"]
  sensitive  = false
}
