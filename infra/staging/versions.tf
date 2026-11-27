terraform {
  required_version = ">= 1.11, < 2.0"

  required_providers {
    appwrite = {
      source  = "appwrite/appwrite"
      version = "= 2.8.0"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "= 5.27.1"
    }
  }
}
