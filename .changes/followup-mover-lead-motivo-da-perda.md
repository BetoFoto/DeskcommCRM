---
impacto: capacidade_nova
secao: corrigido
titulo: O bloco Mover lead no funil agora pede o motivo da perda quando o destino é etapa de perda, e a recusa aparece na linha do tempo
---

Antes, um fluxo com o bloco "mover lead" apontando para a etapa de perda publicava sem pedir motivo nenhum: na hora de rodar, o card não se movia e o fluxo aparecia como concluído, sem dizer que o negócio continuava aberto. Agora o construtor mostra o seletor de "Motivo da perda" com as mesmas opções do "Marcar como perdido" do quadro, e a publicação recusa o fluxo enquanto o motivo não estiver escolhido.

Fluxos antigos continuam como estavam e não precisam ser refeitos: se um deles cair na recusa, a falha passa a aparecer na linha do tempo da inscrição, dizendo que o card não foi movido e por quê. O motivo escolhido no bloco é gravado no negócio como o do "Marcar como perdido".
