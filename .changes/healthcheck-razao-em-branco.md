---
impacto: nada_mudou
secao: corrigido
titulo: O diagnóstico passa a mostrar por que o agente de atualização falhou, em vez de uma linha em branco
---

Quando o agente que faz a atualização pela tela falhava ao falar com o app, o
`bash hostgator-setup-kit/healthcheck.sh` avisava "o agente falhou recentemente
ao falar com o app:" e, no lugar do motivo, mostrava uma linha vazia. Isso
acontecia sempre que a resposta do app terminava em quebra de linha (por exemplo,
o "no available server" de um proxy na frente do app).

Agora o diagnóstico mostra a última falha registrada inteira, numa linha: a hora,
o endereço chamado, a resposta e o código HTTP. Nada precisa ser feito na VPS.
