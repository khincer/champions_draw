mock_provider "appwrite" {}
mock_provider "vercel" {}

variables {
  appwrite_project_id   = "champions-draw-staging"
  appwrite_api_origin   = "https://champions-api-staging.appwrite.run"
  vercel_staging_origin = "https://staging.example.com"
}

run "staging_platform_configuration" {
  command = plan

  assert {
    condition = (
      appwrite_function.staging["api"].runtime == "python-3.13" &&
      appwrite_function.staging["api"].entrypoint == "deploy/appwrite/django_http.py" &&
      toset(appwrite_function.staging["api"].execute) == toset(["any"])
    )
    error_message = "Only the Django API should be usable by public HTTP clients."
  }

  assert {
    condition = alltrue([
      for key, filename in {
        sync_leagues = "sync_leagues.py"
        sync_results = "sync_results.py"
        } : (
        appwrite_function.staging[key].entrypoint == "deploy/appwrite/${filename}" &&
        length(appwrite_function.staging[key].execute) == 0 &&
        length(appwrite_function.staging[key].events) == 0 &&
        appwrite_function.staging[key].schedule == "" &&
        coalesce(appwrite_function.staging[key].interval, 0) == 0
      )
    ])
    error_message = "Both sync jobs must remain private and unscheduled."
  }

  assert {
    condition = (
      alltrue([for function in appwrite_function.staging : function.commands == "pip install -r requirements.txt"]) &&
      alltrue([for env in appwrite_function_variable.django : contains(["DJANGO_DEBUG", "DJANGO_ALLOWED_HOSTS", "DJANGO_CSRF_TRUSTED_ORIGINS"], env.key)]) &&
      appwrite_function_variable.django["api_csrf"].value == "https://staging.example.com" &&
      appwrite_function_variable.django["api_hosts"].value == "champions-api-staging.appwrite.run,staging.example.com" &&
      appwrite_function_variable.django["sync_leagues_hosts"].value == "champions-api-staging.appwrite.run,staging.example.com" &&
      appwrite_function_variable.django["sync_results_hosts"].value == "champions-api-staging.appwrite.run,staging.example.com"
    )
    error_message = "Only nonsecret public Django settings should be managed."
  }

  assert {
    condition = (
      vercel_project.staging.name == "champions-draw-staging" &&
      vercel_project.staging.framework == "vite" &&
      try(length(vercel_project.staging.git_repository), 0) == 0 &&
      vercel_project_environment_variable.api_origin[0].key == "APPWRITE_API_ORIGIN" &&
      vercel_project_environment_variable.api_origin[0].value == "https://champions-api-staging.appwrite.run" &&
      toset(vercel_project_environment_variable.api_origin[0].target) == toset(["preview"]) &&
      !vercel_project_environment_variable.api_origin[0].sensitive
    )
    error_message = "Vercel should link the public API origin to Preview only, without Git autodeploy."
  }
}

run "bootstrap_without_appwrite_origin" {
  command = plan

  variables {
    appwrite_api_origin   = null
    vercel_staging_origin = null
  }

  assert {
    condition = (
      length(appwrite_function.staging) == 3 &&
      length(vercel_project_environment_variable.api_origin) == 0 &&
      !contains(keys(appwrite_function_variable.django), "api_hosts") &&
      !contains(keys(appwrite_function_variable.django), "api_csrf")
    )
    error_message = "The functions must be provisionable before the API domain is known."
  }
}

run "build_preview_before_frontend_origin_is_known" {
  command = plan

  variables {
    vercel_staging_origin = null
  }

  assert {
    condition = (
      vercel_project_environment_variable.api_origin[0].value == "https://champions-api-staging.appwrite.run" &&
      appwrite_function_variable.django["api_hosts"].value == "champions-api-staging.appwrite.run" &&
      !contains(keys(appwrite_function_variable.django), "api_csrf")
    )
    error_message = "The preview must build before its generated hostname can be trusted by Django."
  }
}

run "reject_api_origin_with_path" {
  command = plan

  variables {
    appwrite_api_origin = "https://champions-api-staging.appwrite.run/api"
  }

  expect_failures = [var.appwrite_api_origin]
}

run "reject_nonstaging_project_name" {
  command = plan

  variables {
    vercel_project_name = "champions-draw"
  }

  expect_failures = [var.vercel_project_name]
}

run "reject_wildcard_frontend_origin" {
  command = plan

  variables {
    vercel_staging_origin = "https://*.example.com"
  }

  expect_failures = [var.vercel_staging_origin]
}
