---
impacto: nada_mudou
secao: corrigido
titulo: Editor do roteador volta a mostrar o funil de destino gravado na intenção
---

Ao abrir o editor de um roteador, o seletor "Funil de destino" de cada intenção mostrava "Sem destino — só escolher o agente" mesmo com o funil gravado no banco, e salvar sem reescolher de novo apagava o destino (o `pipeline_id` era gravado nulo). A tela montava o rascunho das intenções a partir do estado que veio do servidor e nunca mais consultava a API: nos 30 primeiros segundos aquele estado é tratado como fresco, então o detalhe não era buscado, a reidratação do rascunho não disparava e o seletor ficava vazio para sempre — com a API devolvendo o funil o tempo todo. Agora o estado do servidor vale só enquanto a busca não volta: o editor busca o estado atual ao abrir e o rascunho reidrata com o que a API devolve, sem sobrescrever o que a pessoa acabou de digitar. Nada precisa ser feito ao atualizar. Contribuição de @webtecnica (#2569).
