---
impacto: nada_mudou
secao: corrigido
titulo: O eco da mensagem que a IA acabou de enviar não pausa mais a IA
---

Quando a linha do envio ficava `sent` sem o id do canal — desfecho dos dois
caminhos de envio quando o eco vence o índice único de `external_id` —, a
reentrega do eco da nossa própria mensagem era lida como "uma pessoa respondeu
pelo canal": a IA ficava pausada por 1 hora, a frase aparecia duas vezes na
conversa e a conversa ainda tentava nascer no funil como se tivesse começado
pelo celular. A ingestão passou a reconhecer que a mensagem saiu (`queued`,
`sending`, `sent`, `delivered`, `read`) e a régua por id continua sendo a
primeira: mensagem digitada de verdade no aparelho continua pausando a IA.

Contribuição de @webtecnica (#3162).
