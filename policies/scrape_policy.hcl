// Resource definitions
resource "website" {
  roles = ["admin", "pro_user", "free_user"]
  attributes = {
    "domain" = "string"
    "is_premium" = "bool"
  }
}

// Role definitions
role "admin" {
  name = "Administrator"
  description = "Full access to all scraping features"
}

role "pro_user" {
  name = "Pro User"
  description = "Access to premium features and higher rate limits"
}

role "free_user" {
  name = "Free User"
  description = "Basic scraping features with limitations"
}

// Free user policy
policy "free_user_basic_scrape" {
  resource = "website"
  role = "free_user"
  actions = ["scrape_basic"]
  effect = "allow"
  conditions = [
    condition "rate_limit" {
      match = "user.requests_per_hour <= 50"
    },
    condition "non_premium" {
      match = "!resource.is_premium"
    }
  ]
}

// Pro user policy
policy "pro_user_basic_scrape" {
  resource = "website"
  role = "pro_user"
  actions = ["scrape_basic"]
  effect = "allow"
}

policy "pro_user_advanced_scrape" {
  resource = "website"
  role = "pro_user"
  actions = ["scrape_advanced"]
  effect = "allow"
  conditions = [
    condition "rate_limit" {
      match = "user.requests_per_hour <= 500"
    }
  ]
}

// Admin policy
policy "admin_full_access" {
  resource = "website"
  role = "admin"
  actions = ["scrape_basic", "scrape_advanced", "scrape_premium", "scrape_manage"]
  effect = "allow"
}