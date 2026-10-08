---
impacto: nada_mudou
secao: corrigido
titulo: Arrastar um card no funil com filtro ligado não embaralha mais a ordem da etapa
---

Com qualquer filtro ligado no funil (busca, tag, responsável), soltar um card podia dar a ele a MESMA `position_in_stage` de um card que o filtro estava escondendo. Acontecia em dois lugares: no fim da coluna visível, onde a conta era `último + 1000` — exatamente a posição do card escondido logo abaixo —, e entre dois cards visíveis, onde a média podia cair em cima do escondido do meio.

Nada aparecia de errado na hora. O problema aparecia quando o filtro saía: os dois cards ficavam empatados e a ordem entre eles passava a ser a que o banco devolvia em cada refetch, e arrastar outro card PARA ENTRE os dois era cancelado sem aviso — o card voltava ao lugar de origem sem toast, sem erro e sem requisição.

Agora o vizinho de baixo do card solto é contado na etapa INTEIRA, lida do cache do quadro (que a página preenche sem filtro), em vez da lista visível que o filtro reduziu. Sem filtro as duas listas coincidem e o arrasto continua exatamente como antes.

Não muda banco nenhum: esta entrega não cria migração.

Contribuição de @webtecnica (#2558), a partir da issue #2545 de @hudson-souza-mkt.
