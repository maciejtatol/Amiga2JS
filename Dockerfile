# syntax=docker/dockerfile:1.7

FROM node:22.13-bookworm-slim AS dependencies

WORKDIR /workspace

# Copy manifests first so dependency installation stays cached across source edits.
COPY package.json package-lock.json .npmrc ./
COPY apps/cli/package.json apps/cli/package.json
COPY packages/compatibility/package.json packages/compatibility/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/evidence/package.json packages/evidence/package.json
COPY packages/persistence/package.json packages/persistence/package.json
COPY packages/runtime-amiberry/package.json packages/runtime-amiberry/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/source-amiga-hunk/package.json packages/source-amiga-hunk/package.json
COPY packages/static-analysis/package.json packages/static-analysis/package.json
COPY packages/target-typescript/package.json packages/target-typescript/package.json
COPY packages/verification/package.json packages/verification/package.json

RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

FROM dependencies AS checks

COPY . .
RUN npm run lint \
  && npm run typecheck \
  && npm test \
  && npm run acceptance --workspace @retroport/cli

FROM checks AS production-dependencies

# The CLI executes TypeScript through tsx, which is therefore a production dependency.
RUN npm prune --omit=dev

FROM node:22.13-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /workspace

COPY --from=production-dependencies /workspace/node_modules ./node_modules
COPY --from=production-dependencies /workspace/package.json /workspace/package-lock.json /workspace/.npmrc ./
COPY --from=production-dependencies /workspace/apps ./apps
COPY --from=production-dependencies /workspace/packages ./packages
COPY --from=production-dependencies /workspace/compatibility ./compatibility
COPY --from=production-dependencies /workspace/fixtures ./fixtures
COPY --from=production-dependencies /workspace/docs ./docs

# SQLite files live here and are persisted by the Compose named volume.
RUN mkdir /data && chown node:node /data
VOLUME ["/data"]

USER node
ENTRYPOINT ["node", "--import", "tsx", "apps/cli/src/index.ts"]
CMD ["acceptance"]
