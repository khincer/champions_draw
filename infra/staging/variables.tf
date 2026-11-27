variable "appwrite_project_id" {
  description = "ID of an existing Appwrite project dedicated to staging."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$", var.appwrite_project_id))
    error_message = "Enter a valid staging Appwrite project ID."
  }
}

variable "appwrite_api_origin" {
  description = "Public HTTPS origin of the Appwrite API function. Leave null until the staging function has a domain."
  type        = string
  default     = null

  validation {
    condition = var.appwrite_api_origin == null || can(regex(
      "^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$",
      var.appwrite_api_origin
    ))
    error_message = "Supply a bare HTTPS origin with a lowercase hostname and no port, path, or trailing slash."
  }
}

variable "vercel_project_name" {
  description = "Name of the Vercel project dedicated to staging."
  type        = string
  default     = "champions-draw-staging"
  nullable    = false

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,90}-staging$", var.vercel_project_name))
    error_message = "Use a lower-case Vercel project name that ends in -staging."
  }
}

variable "vercel_staging_origin" {
  description = "Exact HTTPS origin browsers will use for the staged frontend. Leave null until the preview URL is known."
  type        = string
  default     = null

  validation {
    condition = var.vercel_staging_origin == null || can(regex(
      "^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$",
      var.vercel_staging_origin
    ))
    error_message = "Supply one bare HTTPS origin with a lowercase hostname and no wildcard, port, path, or trailing slash."
  }
}

variable "vercel_team" {
  description = "Optional Vercel team ID or slug. Leave null for the authenticated account."
  type        = string
  default     = null
}

variable "sync_timeout_seconds" {
  description = "Timeout for both staging sync functions; respect the Appwrite plan limit when overriding it."
  type        = number
  default     = 60
  nullable    = false

  validation {
    condition     = var.sync_timeout_seconds >= 15 && var.sync_timeout_seconds <= 900 && floor(var.sync_timeout_seconds) == var.sync_timeout_seconds
    error_message = "Sync timeout must be a whole number between 15 and 900 seconds."
  }
}
