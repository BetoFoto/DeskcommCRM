---
impacto: nada_mudou
secao: corrigido
titulo: Testar do agente agora prepara a foto do produto como o envio real
---

Quando o agente testava uma resposta que usaria a foto de um produto, o teste olhava só o texto e dava como válido mesmo quando a foto não era encontrada no catálogo, não copiava ou não ficava pronta. Agora o teste prepara a foto do mesmo jeito que o envio de verdade prepara: procura o produto no catálogo, copia as fotos e só então avalia. Se a foto não ficar pronta, o teste é reprovado e diz o motivo; se o produto não tiver foto nenhuma, o texto segue com um aviso de que nenhuma imagem sairia.

Nada disso manda mensagem: o teste continua sem enviar nada, sem anexar arquivo em conversa de cliente e sem gravar nada no banco. Nenhum dado antigo muda e nada precisa ser feito ao atualizar.

Contribuição de @webtecnica (#2538, refs #2490).
