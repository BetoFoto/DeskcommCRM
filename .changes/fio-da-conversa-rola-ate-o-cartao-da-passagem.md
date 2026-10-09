---
impacto: nada_mudou
secao: corrigido
titulo: O fio da conversa volta a rolar até o fim quando o cartão de passagem chega antes das mensagens
---

Quem abria uma conversa recém-passada para humano via o cabeçalho do cartão "Por
que a IA passou para você" e o convite "Assumir e responder" montado, clicável e
FORA da janela — o gesto que resolve o atendimento existia e ninguém o via. O
defeito era intermitente porque dependia da ordem de chegada das duas consultas
do fio: quando as passagens resolviam antes das mensagens, o esqueleto de
carregamento ainda estava na tela, o fio de verdade ainda não existia, e a
rotina de ancoragem marcava a abertura como concluída sobre um destino inexistente.
Quando as mensagens chegavam, a rotina acreditava que alguém estava lendo o
histórico e devolvia sem rolar. Agora a abertura só se encerra com o fio de
verdade montado, então a conversa sempre termina no fim, junto do convite.
Nada precisa ser feito ao atualizar. Contribuição de @webtecnica (#2664, issue #2515).
