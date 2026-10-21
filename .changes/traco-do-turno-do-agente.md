---
impacto: capacidade_nova
secao: adicionado
titulo: Cada turno do agente passa a deixar o registro do que aconteceu nele
---

Toda execução do agente agora deixa uma linha com o que aconteceu naquele turno:
o modelo que respondeu e o total de tokens, custo e latência; as skills que
entraram; as fontes de conhecimento ligadas, com versão e hash; as ferramentas
que o modelo chamou — com nome, estado (deu certo, falhou ou foi barrada pelo
circuit breaker), erro e duração —; e como o turno terminou, inclusive quando
falha ou é devolvido à fila sem enviar. O Teste do agente deixa a mesma linha,
marcada como prévia, para nunca ser confundida com um turno que falou com alguém
de verdade. É o que faltava para explicar, olhando o histórico, por que o agente
respondeu daquele jeito.
