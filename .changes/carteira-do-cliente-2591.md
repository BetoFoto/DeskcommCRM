---
impacto: capacidade_nova
secao: adicionado
titulo: O contato ganha um vendedor dono, o dono é avisado quando o cliente fala com outro, e o negócio novo nasce com o dono
---

O cliente passa a ter carteira própria: três colunas novas em `contacts` (`carteira_user_id`, `carteira_origem`, `carteira_definida_em`) gravadas só pelo servidor — a sessão (`authenticated`/`anon`) é recusada com 42501 se mexer nelas, e `fn_definir_carteira_do_cliente` (manager+ da mesma organização) valida o papel de quem chama e do dono candidato, grava e adota na mesma transação os negócios abertos sem dono do contato. Quando o cliente fala com outro vendedor, o dono da carteira recebe uma tarefa interna de aviso (uma por cliente enquanto houver pendente) — sem mensagem nova ao cliente. E o negócio novo nasce com o dono da carteira por gatilho, cobrindo os cinco caminhos de criação; sem carteira qualificada o rodízio atual continua decidindo. Sem backfill: contato sem carteira é o comportamento de hoje, e ninguém perde carteira por causa do gatilho.

Contribuição de @webtecnica (#2667).
