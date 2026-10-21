---
impacto: nada_mudou
secao: corrigido
titulo: A recusa da inscrição de push aparece na tela, e o interruptor não fica ligado mentindo
---
Quando o servidor recusava a inscrição de push do aparelho — por exemplo, quando o endereço de push não é de um serviço conhecido — a tela de Notificações não dizia nada: o interruptor de Push ficava ligado, a pessoa achava que ia ser avisada, e nenhum aviso chegava com o site fechado. Agora, quando a inscrição é recusada, a tela mostra a recusa do servidor e o interruptor volta a ficar desligado, porque de fato nada foi gravado. A inscrição aceita continua exatamente como antes. Nada a fazer na atualização.

E o mesmo valia para os outros caminhos em que nada é inscrito: quando o navegador não registra o service worker, quando a instalação ainda não tem o par de chaves do Push (VAPID) e quando o próprio navegador recusa criar a inscrição. Nesses casos o interruptor também voltava a ficar ligado sem avisar — e agora ele desliga dizendo qual dos motivos foi, para a pessoa saber de quem é o problema. Quando o motivo é só uma preferência dela (a permissão não concedida ou o canal de push desligado), o interruptor continua como está: ali ele diz uma escolha, não uma promessa de entrega.

Contribuição de @webtecnica (#3157, #3164).
