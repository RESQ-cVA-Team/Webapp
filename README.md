# Webapp

Run instructions for:

- Development using the Dev Container
- Production using GitHub workflow-built images

## Service Wiring

- Webapp -> Rasa REST API (chat, history, tracker)
- Webapp -> Action callback receiver (`/api/rasa/long-task-callback`)
- Action -> Webapp secured proxy (`/api/rasa-proxy`)
- Webapp -> external upstream APIs (GraphQL/analytics and CVA)
- Webapp -> Keycloak for authentication

## Required Environment Variables

- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `KEYCLOAK_CLIENT_ID`
- `KEYCLOAK_CLIENT_SECRET`
- `KEYCLOAK_ISSUER`
- `RASA_URL_LIST` (example: `en=http://rasa:5005`)
- `RASA_AUTH_TOKEN`
- `ACTION_SERVER_TOKEN` (must match Action)
- `LONG_TASK_CALLBACK_TOKEN` (must match Action)
- `RASA_PROXY_TARGETS` (must include `graphql`; usually also `analytics`)
- `CVA_BASE_URL`

If feedback is enabled:

- `MESSAGE_FEEDBACK_ENABLED=true`
- `FEEDBACK_REPORTER_SALT` (required)

## Development (Dev Container)

1. Open this repository in VS Code.
2. Reopen in container.
3. Start dev server:

```bash
pnpm dev
```

The dev container definition is in `.devcontainer/Dockerfile`.

## Production (Workflow-built image)

GitHub workflows build and publish Webapp images to GHCR.

Typical tags:

- `ghcr.io/<org>/webapp:latest`
- `ghcr.io/<org>/webapp:<git-sha>`

Run example:

```bash
docker run --rm -p 3000:3000 \
  -e NEXTAUTH_SECRET=<secret> \
  -e NEXTAUTH_URL=https://<public-webapp-url> \
  -e KEYCLOAK_CLIENT_ID=<id> \
  -e KEYCLOAK_CLIENT_SECRET=<secret> \
  -e KEYCLOAK_ISSUER=https://<issuer>/realms/<realm> \
  -e RASA_URL_LIST=en=http://rasa:5005 \
  -e RASA_AUTH_TOKEN=<shared-rasa-token> \
  -e ACTION_SERVER_TOKEN=<shared-action-token> \
  -e LONG_TASK_CALLBACK_TOKEN=<shared-callback-token> \
  -e RASA_PROXY_TARGETS='{"graphql":"https://<host>","analytics":"https://<host>"}' \
  -e CVA_BASE_URL=https://<host>/api/rest/cva/v1 \
  ghcr.io/<org>/webapp:latest
```
