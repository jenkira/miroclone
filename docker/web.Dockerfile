ARG BUILD_IMAGE=node:22-bookworm-slim
ARG RUNTIME_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

FROM ${BUILD_IMAGE} AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@miroclone/web..." \
 && pnpm --filter @miroclone/web build

FROM ${RUNTIME_IMAGE}
COPY docker/nginx.conf docker/security-headers.conf /etc/nginx/
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
