---
impacto: nada_mudou
secao: corrigido
titulo: O diálogo de anexos não pede mais legenda para áudio
---
Ao enviar um anexo de áudio, o diálogo de prévia pedia uma "Legenda" — e nenhum canal entrega texto junto de áudio, então o texto era escrito e nunca chegava ao cliente. Agora o campo só aparece quando a fila tem um anexo que leva legenda (imagem, vídeo ou documento); com áudio, o envio sai sem pedir o texto. Numa fila com imagem e áudio juntos o campo continua, e a legenda viaja com a imagem. Se o recurso de áudio trazia um texto no corpo, ele volta para o campo de mensagem — em vez de viajar como legenda de um áudio que a descartaria — e o operador decide quando mandá-lo. Nada a fazer na atualização.

Corrigido por @webtecnica (#3151).
