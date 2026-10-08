---
impacto: nada_mudou
secao: alterado
titulo: O registro de auditoria de cada ferramenta do assistente passa a guardar o tamanho da resposta
---

Cada chamada de ferramenta do assistente, pelo agente de atendimento ou por uma integração externa, já ficava registrada na auditoria. Agora o registro guarda também quantos bytes a ferramenta devolveu ao modelo, na chave `result_bytes`: só o número, nunca o conteúdo, que pode ter dado pessoal. Serve para medir o custo de IA por ferramenta. Chamadas que terminaram em erro ou recusa ficam sem o número, porque não houve resposta a medir.

Nada precisa ser feito ao atualizar, e nenhuma tela muda: a chave aparece só no detalhe cru do registro em Auditoria. Contribuição de Paulo Lima Jr (@paulolimajr77) (#2614).
