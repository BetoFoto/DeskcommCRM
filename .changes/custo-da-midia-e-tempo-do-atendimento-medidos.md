---
impacto: capacidade_nova
secao: adicionado
titulo: O gasto de IA com fotos, áudios e vídeos passa a aparecer em Uso de IA e em Execuções
---
Até aqui, descrever a foto que o cliente mandou, transcrever o áudio dele e ler os quadros de um vídeo eram chamadas pagas que não deixavam rastro: não entravam na tela de Uso de IA, não apareciam em Execuções e não contavam para o teto de orçamento. Agora cada uma dessas chamadas grava uma linha, nos pontos "Ver a imagem do cliente" e "Ouvir o áudio do cliente". A imagem aparece com tokens e custo quando o modelo está na tabela de preços do sistema. O áudio aparece com a contagem e o tempo de cada chamada, mas sem valor, porque a transcrição é cobrada por minuto e esse preço o sistema ainda não conhece. Como agora contam para o orçamento, o gasto do mês pode subir em relação ao que a tela mostrava antes: não é custo novo, é custo que já existia e não aparecia. Quando a leitura é recusada antes de sair (endereço não aceito, ou chave da instalação num endereço da empresa), nada é gravado, porque nada foi cobrado.

O worker também passa a gravar, para cada atendimento, quanto ele esperou na fila e quanto durou. O novo guia `docs/runbooks/medir-custo-e-latencia-da-ia.md` traz as consultas prontas: custo e cache por ponto, atendimentos por dia e custo médio de cada um, e o tempo até a primeira resposta da IA, com a espera proposital antes de responder (a janela que aguarda o cliente terminar de escrever e a pausa que imita digitação) separada da demora de verdade. Não é preciso fazer nada na instalação.
