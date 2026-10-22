---
impacto: capacidade_nova
secao: adicionado
titulo: Mensagem apagada fica cinza, diz quem apagou, e o apagamento pelo aplicativo entra na auditoria
---
Quando alguém apaga uma mensagem ("apagar para todos"), a bolha agora sai das cores da direção e vira **cinza**, com o marcador dizendo **quem** apagou: o contato ou o atendente. Antes, a única diferença era uma opacidade. A **auditoria** passa a registrar também o apagamento que chega pelo aplicativo (o do contato, ou o do próprio número da empresa pelo celular), que não deixava rastro nenhum. A trilha guarda o EVENTO, nunca o corpo: `api_audit_log` é append-only, com retenção de 5 anos, e sobrevive ao apagamento da organização. Quem vê o texto apagado continua como antes: o do contato não aparece, o do atendente segue visível à equipe só no CRM, e o PDF da conversa não traz nenhum dos dois.

Contribuição de @webtecnica (#3279).
