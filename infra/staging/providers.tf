provider "appwrite" {
  project_id = var.appwrite_project_id
}

provider "vercel" {
  team = var.vercel_team
}
