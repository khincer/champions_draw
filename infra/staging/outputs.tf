output "appwrite_function_ids" {
  description = "Function IDs for the separate Appwrite code release."
  value       = { for key, function in appwrite_function.staging : key => function.id }
}

output "vercel_project_id" {
  description = "Vercel staging project to link the CLI to."
  value       = vercel_project.staging.id
}
