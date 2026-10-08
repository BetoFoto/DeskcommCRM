---
impacto: nada_mudou
secao: corrigido
titulo: Um negócio recusado pela regra de visibilidade agora sai como "sem permissão", e não mais como erro interno
---

Quando a organização enxerga "Só os seus" e um Atendente cria um negócio pelo botão "Novo Lead", o sistema avisava "Erro interno. Tente de novo em instantes." — e tentar de novo nunca resolvesse, porque quem recusava a gravação era a própria regra de visibilidade da empresa. Agora a resposta é 403 com a frase explicando que o negócio ficaria fora do que a pessoa pode ver. O mesmo vale para a edição pelo PATCH, quando o Atendente passa o próprio negócio para um colega. Nada muda para quem já gravava normalmente.

Contribuição de @webtecnica (#2556, refs #2547).
