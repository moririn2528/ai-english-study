# infra: Cloudflare Access

Terraform that puts the `ai-english-study` Worker behind Cloudflare Access.
Only the addresses in `allowed_emails` can open the app; they sign in with a
one-time PIN emailed by Cloudflare. The Worker itself is still deployed with
`npm run deploy` (Wrangler).

## Prerequisites

- Zero Trust enabled on the Cloudflare account (one-time dashboard setup).
- A Cloudflare API token with these **account** permissions:
  - Access: Apps and Policies — Edit
  - Workers Scripts — Read

## Usage

```sh
cd infra
cp terraform.tfvars.example terraform.tfvars   # set account_id and allowed_emails
echo 'CLOUDFLARE_API_TOKEN=<token>' > .env     # .env is git-ignored
direnv allow                                   # .envrc loads .env on cd
terraform init
terraform plan
terraform apply
```

To change who can sign in, edit `allowed_emails` and run `terraform apply`.

State is kept locally (`terraform.tfstate`, git-ignored). Keep that file; if
it is lost, re-import the two Access resources before applying again.
