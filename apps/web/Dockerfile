# O Vite grava VITE_API_URL dentro do bundle, no build — não em tempo de
# execução. Passar a variável só no compose deixaria o site procurando a API em
# localhost no navegador do jogador.
FROM oven/bun:1.3.13-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/protocol/package.json packages/protocol/
RUN bun install --frozen-lockfile
COPY packages/protocol packages/protocol
COPY apps/web apps/web
RUN cd apps/web && bun run build

# O resultado é um punhado de arquivos estáticos. Um Caddy de 15 MB serve eles
# e devolve o index.html em qualquer rota, que é o que uma SPA precisa.
FROM caddy:2-alpine
COPY --from=build /app/apps/web/dist /srv
RUN printf ':80 {\n\troot * /srv\n\ttry_files {path} /index.html\n\tfile_server\n\tencode zstd gzip\n}\n' > /etc/caddy/Caddyfile
EXPOSE 80
