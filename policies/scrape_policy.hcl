policy "free_user_policy" {
  resource = "website"
  role     = "free_user"
  action   = "read"
  effect   = "allow"
}

policy "pro_user_policy" {
  resource = "website"
  role     = "pro_user"
  action   = "read"
  effect   = "allow"
}