---
impacto: nada_mudou
secao: corrigido
titulo: O custo de cada turno do agente deixa de ser arredondado para 1 centavo
---

O custo gravado em cada execução do agente era arredondado para cima até o
centavo inteiro. Uma chamada pequena, que custa frações de centavo, aparecia
como 1 centavo — e o limite de gasto por chamada do agente comparava com esse
número inflado. Agora o custo é gravado como fração, igual ao das outras
chamadas de IA.
