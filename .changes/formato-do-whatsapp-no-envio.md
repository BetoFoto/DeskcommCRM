---
impacto: nada_mudou
secao: corrigido
titulo: As mensagens da IA chegam ao WhatsApp sem "\n" escrito e sem asteriscos duplos
---

Medido em conversas reais: às vezes o modelo escrevia o salto de linha como texto — o cliente lia "Tómate tu tiempo.\n\nCualquier duda…" com a barra e o "n" na tela — e usava o negrito do Markdown (`**texto**`), que o WhatsApp não entende e mostra com os asteriscos duplos.

Agora, antes de sair, a mensagem do agente passa para o formato do WhatsApp: o `\n` escrito vira salto de linha de verdade, `**negrito**` vira `*negrito*`, `__itálico__` vira `_itálico_`, um título `## Assim` vira negrito, e linhas em branco em excesso são juntadas. Texto que já vem no formato do WhatsApp não muda. A conversão acontece antes das outras conferências do envio, então o corpo vazio, a divisão em bolhas e a pausa humana medem exatamente o que o cliente recebe.

Não é preciso fazer nada na instalação.
