---
impacto: exige_acao
secao: alterado
titulo: A rota global do webhook do WhatsApp só atende a rede interna da stack
---

A rota global do webhook do WhatsApp (`/api/v1/webhooks/waha`, sem token) é a
que o WAHA da própria stack chama pela rede interna do Docker. Agora a própria
aplicação responde 404 nessa rota a requisições que chegam pelos proxies de
borda que o kit sobe (Caddy, Traefik, Nginx Proxy Manager, túnel da Cloudflare).

O WAHA da stack passa a chamar o app sempre por `http://app:3000`, fixo no
compose, e segue entregando as mensagens como antes — sem editar nenhum
arquivo. A rota com token (`/api/v1/webhooks/waha/<token>`) não muda.

## Requer atenção

Só para quem roda o WAHA em OUTRO servidor e o fez entregar na rota global pelo
domínio do CRM: aponte o webhook desse WAHA para a rota com token do canal,
`https://<seu-domínio>/api/v1/webhooks/waha/<token-do-canal>` (passo a passo em
`docs/runbooks/waha-hostgator.md`). Quem usa o WAHA que vem na stack não precisa
fazer nada.
