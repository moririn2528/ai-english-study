variable "account_id" {
  description = "Cloudflare account ID that owns the Worker."
  type        = string
}

variable "worker_name" {
  description = "Worker name (must match `name` in wrangler.jsonc)."
  type        = string
  default     = "ai-english-study"
}

variable "allowed_emails" {
  description = "Email addresses allowed to sign in (one-time PIN sent by Cloudflare Access)."
  type        = list(string)

  validation {
    condition     = length(var.allowed_emails) > 0
    error_message = "allowed_emails must contain at least one address."
  }
}

variable "session_duration" {
  description = "How long a sign-in stays valid."
  type        = string
  default     = "24h"
}
