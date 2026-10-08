---
impacto: nada_mudou
secao: corrigido
titulo: O instalador deixa de escolher a rede errada quando o Traefik está em mais de uma rede
---

Quando o Traefik da hospedagem estava ligado a mais de uma rede Docker, o
instalador escolhia a primeira em ordem alfabética, que podia não ser a rede pela
qual o Traefik alcança os sites. A instalação terminava, mas o domínio não abria
o CRM.

Agora, havendo mais de uma rede, o instalador usa a `coolify` quando ela está
entre elas. Se não estiver, ele para e lista as redes encontradas, pedindo que
você informe a certa em `TRAEFIK_NETWORK` no `.env`. Quem já declarou
`TRAEFIK_NETWORK` e quem já instalou não precisa fazer nada.
