# terraform/postgres — managed PostgreSQL on Render

Issue: [#796](https://github.com/Trust-Analysis/Tokenized-Fractional-/issues/796)

Provisions the PostgreSQL instance the backend API connects to. Before this,
the database existed only as a `DATABASE_URL` in an environment: its plan,
region, version and retention were whatever the dashboard happened to say, and
there was no way to review a change to them or to reproduce the instance.

The backend services themselves stay in [`render.yaml`](../../render.yaml);
only the database is managed here, because it is the component whose loss is not
recoverable by a redeploy.

## Prerequisites

- Terraform ≥ 1.5
- A Render **API key** (Account Settings → API Keys) in `RENDER_API_KEY`
- The owning user/team ID (`usr-…` / `tea-…`) in `RENDER_OWNER_ID`

```bash
export RENDER_API_KEY=...
export RENDER_OWNER_ID=...
```

## Usage

```bash
cd terraform/postgres
cp terraform.tfvars.example terraform.tfvars   # then edit

terraform init
terraform plan                 # review before applying
terraform apply
```

Read the connection details (sensitive, so they are not shown by a plain
`terraform output`):

```bash
terraform output -json connection_info
```

Copy the **internal** connection string into `DATABASE_URL` for the backend
service in the Render dashboard, or reference the database from `render.yaml`
with `fromService`. It is injected as a secret, not committed.

## Adopting an existing database

Do **not** run `apply` against a database that already exists — Render would
create a second one. Import it into state first:

```bash
terraform import render_postgres.primary dpg-xxxxxxxxxxxxxxxxxxxx
terraform plan                 # expect no changes once imported
```

## Layout

| File | Purpose |
| --- | --- |
| `main.tf` | Provider pin, the `render_postgres` resource |
| `variables.tf` | Inputs and their safe defaults |
| `outputs.tf` | Resource ID and sensitive connection info |
| `terraform.tfvars.example` | Template for environment-specific values |

## Notes

- **Region matters.** It must match the backend services, or the app falls back
  to a public connection instead of Render's private network.
- **State is not configured for remote backends.** `terraform init` writes state
  locally. Before this is applied by more than one person, add a remote backend
  (see [docs/infrastructure.md](../../docs/infrastructure.md)) — otherwise two
  operators hold divergent state and the database can be recreated.
- The AWS WAF/API-Gateway configuration in the parent `terraform/` directory is
  a separate root module with a separate state file.
