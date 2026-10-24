---
impacto: capacidade_nova
secao: adicionado
titulo: A API de contatos filtra quem pediu para não ser incomodado
---

`GET /api/v1/contacts` aceita `?blocked=yes` (só os contatos bloqueados — quem pediu para sair) e `?blocked=no` (só quem ainda pode receber mensagem). Até aqui o bloqueio aparecia só como marca em cada contato, e para montar a lista de quem pediu, ou a de quem ainda dá para contactar antes de uma campanha, era preciso percorrer todos. Sem o parâmetro, a lista segue igual; um valor diferente de `yes`/`no` responde 422.
