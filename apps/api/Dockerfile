# Contexto é a raiz do monorepo: o lockfile e o pacote `protocol` são do
# workspace, e um contexto menor deixaria os dois de fora.
FROM oven/bun:1.3.13-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/protocol/package.json packages/protocol/

# `bun install` roda aqui, e não numa etapa separada que copia node_modules.
# Num workspace o Bun instala as dependências de cada pacote dentro da pasta
# dele, com links para a loja na raiz; copiar só a node_modules da raiz deixava
# a API sem as próprias dependências.
#
# `--filter` limita a instalação a este app e ao pacote que ele importa. Sem
# isso o Bun instala o workspace inteiro — Vite, React, Vitest, Tailwind — tudo
# do site, dentro da imagem do servidor, que nunca vai executar nenhum deles.
# `--production` corta as dependências de desenvolvimento por cima disso.
RUN bun install --frozen-lockfile --production \
      --filter '@typing-race/api' --filter '@typing-race/protocol'

COPY packages/protocol packages/protocol
COPY apps/api apps/api

# A imagem do Bun já traz o usuário `bun`; rodar como root não traria nada além
# de risco.
USER bun
EXPOSE 3001
CMD ["bun", "apps/api/src/index.ts"]
