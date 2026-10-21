---
impacto: nada_mudou
secao: corrigido
titulo: O turno adiado pelo horário do agente não conta roteamento duas vezes
---
Quando a mensagem do cliente chegava fora do horário de funcionamento do agente (por exemplo, 19h para um agente que atende das 8h às 18h), o turno era adiado para a abertura — mas o roteador já tinha rodado e a decisão já tinha sido gravada. Ao voltar na abertura, o roteador rodava de novo e o mesmo turno aparecia duas vezes no histórico de roteamento, com a tentativa de mover o card no funil repetida. Agora a decisão da primeira passagem é reaproveitada: um turno, uma decisão. Nada a fazer na atualização.
