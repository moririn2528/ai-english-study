# Cloudflare Access (Zero Trust) protection for the ai-english-study Worker.
#
# The Worker itself (static assets) is deployed by Wrangler (`npm run deploy`).
# This configuration only manages who may open it.
#
# Auth: export CLOUDFLARE_API_TOKEN before running terraform. See README.md.

terraform {
  required_version = ">= 1.6"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.28.1"
    }
  }
}

provider "cloudflare" {}

# Look the Worker up by name. (The single-Worker data source echoes the name back as `id`,
# but Access destinations need the immutable Worker ID.)
data "cloudflare_workers" "all" {
  account_id = var.account_id
}

locals {
  worker_ids = [for w in data.cloudflare_workers.all.result : w.id if w.name == var.worker_name]
}

resource "cloudflare_zero_trust_access_policy" "allowed_users" {
  account_id       = var.account_id
  name             = "${var.worker_name} allowed users"
  decision         = "allow"
  session_duration = var.session_duration

  include = [for e in var.allowed_emails : { email = { email = e } }]
}

resource "cloudflare_zero_trust_access_application" "app" {
  account_id       = var.account_id
  name             = var.worker_name
  type             = "self_hosted"
  session_duration = var.session_duration

  # "worker" covers every URL of this Worker: workers.dev, previews and custom domains.
  destinations = [{
    type      = "worker"
    worker_id = one(local.worker_ids)
  }]

  lifecycle {
    precondition {
      condition     = length(local.worker_ids) == 1
      error_message = "Worker \"${var.worker_name}\" not found. Run `npm run deploy` first."
    }
  }

  policies = [{
    id         = cloudflare_zero_trust_access_policy.allowed_users.id
    precedence = 1
  }]
}
