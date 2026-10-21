---
impacto: capacidade_nova
secao: adicionado
titulo: O clique do anúncio do formulário vai para a atribuição do contato, em qualquer ferramenta
---
Quem recebe lead por formulário — Elementor, RD Station, Respondi ou um envio genérico — passa a ter a origem do anúncio gravada no contato: `fbclid`, `fbc`, `fbp`, `gclid`, `ad_id`, `adset_id` e `campaign_id` deixam de aparecer no card como se a pessoa os tivesse preenchido e passam a alimentar a coluna de origem, que é a que a venda fechada depois reporta à Meta e ao Google. Vale para os três mapeadores de terceiro, que antes ignoravam essas chaves: o clique do anúncio deles não chegava à atribuição nenhuma.

Na mesma linha, a venda de um lead de formulário que **não tem telefone** deixa de ser recusada quando o envio trouxe `fbc`/`fbp` — a identidade que o navegador carrega é suficiente para a Meta reconhecer o cliente. Sem clique, sem `fbc`/`fbp` e sem telefone, a recusa continua igual, com a mesma mensagem no Histórico. Nada a fazer na VPS: nenhuma variável nova e nenhum passo de migração. Crédito: @webtecnica.
