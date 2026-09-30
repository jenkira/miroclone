# Builds the API or collaboration service. Pass SERVICE=api or SERVICE=collab.
# Override the image arguments to pull from the organisation's private registry.
ARG BUILD_IMAGE=node:22-bookworm-slim
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian12:nonroot

FROM ${BUILD_IMAGE} AS build
ARG SERVICE
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@miroclone/${SERVICE}..." \
 && pnpm --filter "@miroclone/${SERVICE}" bundle

FROM ${RUNTIME_IMAGE}
ARG SERVICE
WORKDIR /app
COPY --from=build /src/services/${SERVICE}/dist/main.js ./main.js
COPY --from=build /src/packages/server-core/migrations ./migrations
ENV NODE_ENV=production MIGRATIONS_DIR=/app/migrations
# The distroless "nonroot" image runs as UID 65532, and the app writes nothing to disk.
CMD ["main.js"]
