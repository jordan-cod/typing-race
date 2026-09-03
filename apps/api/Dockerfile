# Contexto é a raiz do monorepo: o lockfile e o pacote `protocol` são do
# workspace, e um contexto menor deixaria os dois de fora.
FROM oven/bun:1.3.13-alpine AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/protocol/package.json packages/protocol/
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.13-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/protocol packages/protocol
COPY apps/api apps/api

# O bun já traz o usuário `bun`; rodar como root aqui não traria nada além de
# risco.
USER bun
EXPOSE 3001
CMD ["bun", "apps/api/src/index.ts"]
