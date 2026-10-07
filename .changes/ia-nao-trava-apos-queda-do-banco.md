---
impacto: nada_mudou
secao: corrigido
titulo: A IA volta a responder sozinha depois de uma queda ou reinício do banco
---

Quando o banco reiniciava (manutenção do Supabase, por exemplo), o agente de IA
podia parar de responder no WhatsApp e só voltar depois de alguém reiniciar o
`worker` na VPS. Nada indicava o problema: a checagem de saúde seguia dizendo que
estava tudo bem, e os pedidos de resposta ficavam acumulando sem ninguém pegar.

Agora uma consulta que fica sem resposta desiste em um minuto, a conexão é
descartada e a próxima tentativa abre uma nova. A IA retoma sozinha. Crédito:
@rafaelbatistazz.
