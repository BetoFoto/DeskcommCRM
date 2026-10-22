---
impacto: nada_mudou
secao: corrigido
titulo: O filtro de palavras do agente passa a decidir a entrada da conversa, não cada mensagem
---

Com o conserto do #2696, o campo "Só responder quando a mensagem falar de algo específico" passou a valer em cada mensagem, inclusive no meio de uma conversa que o agente já tinha começado. O agente respondia "quero um orçamento", perguntava o produto, e a resposta do cliente ("camiseta azul, tamanho M") não tinha nenhuma das palavras configuradas — o agente ficava calado no meio de uma conversa que ele mesmo começou.

Agora o filtro decide a ENTRADA do agente na conversa, como a tela sempre prometeu ("só entra quando a mensagem contiver uma dessas palavras"). Se a conversa já está com um agente atendendo, as mensagens seguintes passam sem filtro: o cliente que respondeu à pergunta do agente recebe resposta. O que não mudou: a PRIMEIRA mensagem de uma conversa nova continua precisando de uma das palavras, a mesma regra da entrada; pedido de atendente e pedido para parar de receber mensagens continuam passando por cima do filtro, mesmo sem a palavra; e áudio ou imagem ainda sem transcrição seguem entrando (o filtro não cala o que não dá para julgar).

Se algum agente seu tem esse campo preenchido, agora não é mais preciso ficar atento às respostas no meio da conversa: basta a mensagem de entrada trazer uma das palavras. Nada a fazer na atualização.

Corrigido por @webtecnica (#PR) para a issue #3142, aberta por @melgarafael.
