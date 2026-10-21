---
impacto: capacidade_nova
secao: adicionado
titulo: A tela de Tarefas filtra por responsável
---

A tela de Tarefas ganhou, ao lado do filtro de situação, o seletor "Responsável": Todos (o de sempre), Minhas, cada pessoa da equipe e Sem responsável. Antes as tarefas da equipe inteira vinham misturadas numa lista só, e quem atende não tinha como ver só as suas. O filtro vale também para a visão de calendário e é aplicado na própria consulta (a lista não perde tarefas por causa do limite de 500). A API `GET /api/v1/tasks` passa a aceitar `assigned_to` com o id de um membro ou `ninguem`. Crédito: @flaviosiq.
