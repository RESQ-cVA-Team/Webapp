# Webapp Service — Runbook

This README only covers:

- How to run the webapp as a developer
- How to run it in production

---

## Related repositories

- Webapp (this repo)
- Action
- Rasa
- SSOT

---

## 1) Development setup

### Prerequisites (recommended path)

- Docker + Docker Compose
- VS Code + Dev Containers extension

### Dev Container workflow (recommended)

1. Open this repository in VS Code.
2. Choose **Reopen in Container**.
3. Wait for post-create setup to finish (`corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile`).
4. Configure `.env` (repo root) as shown below.
5. Run the dev server.

### Option B: Local machine

Local-only prerequisites:

- Node.js 22+
- `pnpm` (or Corepack enabled)

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm install --frozen-lockfile
```

### Configure environment (`.env` in repo root)

Create/update:

```env
CALLBACK_BASE_URL="http://<local-webapp-host>:3000"
RASA_URL_LIST="en=http://<local-rasa-host>:5005"

KEYCLOAK_CLIENT_ID="<keycloak-client-id>"
KEYCLOAK_CLIENT_SECRET="<keycloak-client-secret>"
KEYCLOAK_ISSUER="https://<keycloak-host>/realms/<realm>"
NEXTAUTH_SECRET="<random-long-secret>"

ACTION_SERVER_TOKEN="<shared-action-token>"
LONG_TASK_CALLBACK_TOKEN="<shared-callback-token>"
RASA_PROXY_TIMEOUT_MS=120000
RASA_PROXY_TARGETS='{"graphql":"https://<host>","analytics":"https://<host>"}'

CVA_BASE_URL="https://<cva-api-host>/api/rest/cva/v1"

MESSAGE_FEEDBACK_ENABLED="true"
FEEDBACK_ADMIN_ENABLED="true"
FEEDBACK_CAPTURE_CONTEXT_ENABLED="true"
FEEDBACK_COMMENT_MAX_LENGTH="1000"
FEEDBACK_ADMIN_EMAILS="admin@example.org"
FEEDBACK_ADMIN_ROLES="cva-feedback-admin"
FEEDBACK_REPORTER_SALT="<random-long-secret>"

# Optional external Postgres for feedback storage.
# If omitted, feedback falls back to a local file store for simple testing.
# FEEDBACK_DATABASE_URL="postgresql://<user>:<password>@<postgres-host>:5432/<database>"
# FEEDBACK_DB_HOST="<postgres-host>"
# FEEDBACK_DB_PORT="5432"
# FEEDBACK_DB_NAME="cva_feedback"
# FEEDBACK_DB_USER="postgres"
# FEEDBACK_DB_PASSWORD="postgres"
# FEEDBACK_DB_SSL="false"
# FEEDBACK_LOCAL_STORE_PATH="/app/.data/feedback-store.json"

WEBAPP_VERSION="0.1.0"
WEBAPP_COMMIT_SHA="<git-sha>"
WEBAPP_IMAGE_TAG="webapp:local"

RASA_VERSION_URL="http://<local-rasa-host>:5005/version"
ACTION_VERSION_URL="http://<local-action-host>:5055/version"
SSOT_VERSION_URL="http://<local-ssot-host>:7001/version"
```

`RASA_URL_LIST` supports separators `;`, `,`, or newline, for example `en=http://<rasa-en-host>:5005;el=http://<rasa-el-host>:5006`.

### Feedback storage

The feedback feature is optional and env-gated.

Storage modes:

- No feedback DB env configured: feedback uses a local file store for simple testing
- `FEEDBACK_DATABASE_URL` or `FEEDBACK_DB_*` configured: feedback uses PostgreSQL

Examples:

```env
# Simple local fallback for testing
MESSAGE_FEEDBACK_ENABLED="true"

# External PostgreSQL for shared/dev/prod environments
FEEDBACK_DATABASE_URL="postgresql://<user>:<password>@<postgres-host>:5432/<database>"
```

Notes:

- The local fallback store is intended for development/testing only
- In local dev, the default local file path is `.data/feedback-store.json`
- In containers, the default local file path is `/app/.data/feedback-store.json`
- For production or shared environments, configure PostgreSQL instead of relying on the local fallback
- The PostgreSQL tables are created automatically on first use; no manual migration step is required for the feedback feature

Recommended version endpoint convention for related services:

- Use `GET /version`
- Return JSON with at least `service`, `version`, `commitSha`, `imageTag`
- For Rasa and Action, also include the SSOT version they currently use
- For Action, include the active LLM model/runtime settings when possible

The Webapp itself now exposes `GET /version`.

### Run locally

```bash
pnpm dev
```

Open the local webapp URL you configured for development.

### VS Code tasks (optional)

This repo includes `.vscode/tasks.json` with:

- `Start Webbapp in dev`

Run from VS Code: **Terminal → Run Task**.

---

## 2) Production run

### Required dependencies

- One or more Rasa containers reachable from the Webapp
- Action service token shared with the Action container
- Upstream GraphQL/analytics APIs reachable from Webapp proxy

### Recommended image tags

- `<container-registry>/webapp:latest`
- `<container-registry>/action:latest`
- `<container-registry>/rasa:<locale>-latest`

### Required Webapp environment variables

- `RASA_URL_LIST`
- `CALLBACK_BASE_URL`
- `CVA_BASE_URL`
- `RASA_PROXY_TARGETS`
- `KEYCLOAK_CLIENT_ID`
- `KEYCLOAK_CLIENT_SECRET`
- `KEYCLOAK_ISSUER`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `HOSTNAME=0.0.0.0`
- `ACTION_SERVER_TOKEN`
- `LONG_TASK_CALLBACK_TOKEN`
Optional feedback/admin variables:

- `MESSAGE_FEEDBACK_ENABLED`
- `FEEDBACK_ADMIN_ENABLED`
- `FEEDBACK_CAPTURE_CONTEXT_ENABLED`
- `FEEDBACK_COMMENT_MAX_LENGTH`
- `FEEDBACK_ADMIN_EMAILS`
- `FEEDBACK_ADMIN_ROLES`
- `FEEDBACK_REPORTER_SALT`
- `FEEDBACK_DATABASE_URL`
- `FEEDBACK_DB_HOST`
- `FEEDBACK_DB_PORT`
- `FEEDBACK_DB_NAME`
- `FEEDBACK_DB_USER`
- `FEEDBACK_DB_PASSWORD`
- `FEEDBACK_DB_SSL`
- `FEEDBACK_LOCAL_STORE_PATH`
- `WEBAPP_VERSION`
- `WEBAPP_COMMIT_SHA`
- `WEBAPP_IMAGE_TAG`
- `RASA_VERSION_URL`
- `ACTION_VERSION_URL`
- `SSOT_VERSION_URL`

### Minimal production compose snippet (webapp)

Use this template and replace placeholders:

```yaml
services:
  cva-webapp:
    image: <container-registry>/webapp:latest
    container_name: cva-webapp
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      RASA_URL_LIST: |
        en=http://<rasa-en-service>:5005
        cs=http://<rasa-cs-service>:5005
        el=http://<rasa-el-service>:5005
      CALLBACK_BASE_URL: "http://<webapp-service>:3000"
      CVA_BASE_URL: "https://<cva-api-host>/api/rest/cva/v1"
      RASA_PROXY_TARGETS: '{"graphql":"https://<graphql-host>","analytics":"https://<analytics-host>"}'
      KEYCLOAK_CLIENT_ID: "<keycloak-client-id>"
      KEYCLOAK_CLIENT_SECRET: "<keycloak-client-secret>"
      KEYCLOAK_ISSUER: "https://<keycloak-host>/realms/<realm>"
      NEXTAUTH_SECRET: "<random-long-secret>"
      NEXTAUTH_URL: "https://<public-webapp-url>"
      HOSTNAME: "0.0.0.0"
      ACTION_SERVER_TOKEN: "<shared-action-token>"
      LONG_TASK_CALLBACK_TOKEN: "<shared-callback-token>"
      MESSAGE_FEEDBACK_ENABLED: "true"
      FEEDBACK_ADMIN_ENABLED: "true"
      FEEDBACK_DATABASE_URL: "postgresql://postgres:postgres@feedback-db:5432/cva_feedback"
```

Start:

```bash
docker compose pull
docker compose up -d
```

---

## 3) Quick verification

- `docker compose ps`
- `docker compose logs -f cva-webapp`
- Confirm `RASA_URL_LIST` targets are reachable
- Confirm `ACTION_SERVER_TOKEN` matches Webapp + Action for proxy requests
- Confirm `LONG_TASK_CALLBACK_TOKEN` matches Webapp + Action for callback requests
- Confirm `NEXTAUTH_URL` matches the public URL

---

## 4) Common commands

Run dev server:

```bash
pnpm dev
```

Inspect running stack:

```bash
docker compose ps
docker compose logs -f cva-webapp
```

