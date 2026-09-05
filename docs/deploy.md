# Deploy

Uma imagem, um container, uma porta. O binário Go serve o site e a API.

## O que mudou quando o backend virou Go

Antes eram dois containers — `typing-api` (Bun, 3001) e `typing-web` (Caddy servindo o
bundle, 8080). Agora é um: `typing`, na 3001, servindo `/`, `/api/*` e `/ws`.

Isso exige **uma mudança no Caddy compartilhado** (`~/proxy/Caddyfile` no droplet). O bloco do
domínio do typing deixa de ter dois `reverse_proxy` e passa a ter um:

```caddyfile
{$TYPING_DOMAIN} {
	encode zstd gzip
	reverse_proxy typing:3001
}
```

O `reverse_proxy` do Caddy já repassa `Connection: Upgrade`, então o WebSocket em `/ws` passa
sem configuração extra.

Depois de editar:

```sh
cd ~/proxy && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## O diretório do projeto no servidor

`~/typing-race/` tem o `docker-compose.prod.yml` deste repositório como `docker-compose.yml`,
e um `.env.image` que o CI reescreve a cada deploy com `APP_IMAGE` e `DEPLOYED_SHA`.

A variável `API_IMAGE`/`WEB_IMAGE` do deploy antigo não existe mais. Na primeira subida, os
dois containers velhos precisam sair:

```sh
cd ~/typing-race
docker compose down --remove-orphans
```

## Ordem na primeira vez

O Caddy precisa da mudança **antes** do primeiro deploy da imagem nova, senão ele fica
apontando para `typing-web`, que não vai mais existir.
