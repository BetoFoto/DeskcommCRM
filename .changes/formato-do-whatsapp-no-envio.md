---
impacto: nada_mudou
secao: corrigido
titulo: As mensagens da IA chegam ao WhatsApp sem "\n" escrito e sem asteriscos duplos
---

Medido em conversas reais: às vezes o modelo escrevia o salto de linha como texto — o cliente lia "Tómate tu tiempo.\n\nCualquier duda…" com a barra e o "n" na tela — e usava o negrito do Markdown (`**texto**`), que o WhatsApp não entende e mostra com os asteriscos duplos.

Agora, antes de sair, a mensagem do agente passa para o formato do WhatsApp: o `\n` escrito vira salto de linha de verdade, `**negrito**` e `__negrito__` viram `*negrito*`, um título `## Assim` vira negrito (sem os asteriscos duplos quando o título já vinha com negrito), e linhas em branco em excesso são juntadas. Texto que já vem no formato do WhatsApp não muda, nem os asteriscos e sublinhados duplos colados em palavra, em caminho ou em parâmetro de link (um link com `?__hstc=1` ou `/__init__`, uma senha). A conversão acontece antes das outras conferências do envio, então o corpo vazio, a divisão em bolhas e a pausa humana medem exatamente o que o cliente recebe. A mesma conversão vale para a ação de automação "Mensagem escrita pela IA" e para a primeira mensagem da prospecção, que também levam texto do modelo direto ao cliente.

Não é preciso fazer nada na instalação.

Contribuição de @mentitaa (#2512).
