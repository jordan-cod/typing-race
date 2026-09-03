# O Vite grava VITE_API_URL dentro do bundle, no build — não em tempo de
# execução. Passar a variável só no compose deixaria o site procurando a API em
# localhost no navegador do jogador.
FROM oven/bun:1.3.13-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package.json bun.lock tsconfig.base.json ./
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

# O binário do Caddy vem com a capacidade de abrir portas privilegiadas gravada
# no próprio arquivo. Com `cap_drop: ALL` e `no-new-privileges`, o kernel recusa
# *executar* um arquivo assim — não é o bind que falha, é o exec, e o container
# reinicia para sempre com "operation not permitted". Tirar a capacidade
# resolve, e ela não faz falta: quem abre 80 e 443 na máquina é o proxy.
RUN apk add --no-cache libcap \
 && setcap -r /usr/bin/caddy \
 && apk del libcap

# Porta alta pelo mesmo motivo: acima de 1024 ninguém precisa de capacidade.
RUN printf ':8080 {\n\troot * /srv\n\ttry_files {path} /index.html\n\tfile_server\n\tencode zstd gzip\n}\n' > /etc/caddy/Caddyfile
EXPOSE 8080
