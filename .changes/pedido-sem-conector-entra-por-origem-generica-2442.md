---
impacto: capacidade_nova
secao: adicionado
titulo: Pedidos de plataforma sem integração nativa (Tray, Loja Integrada, WooCommerce) entram por uma origem genérica
---

Quem vende pelo site numa plataforma sem conector próprio no CRM — Tray, Loja Integrada, WooCommerce — já podia gravar pedidos em `orders` por uma ponte própria, mas só se a origem fosse `nuvemshop`, `vtex` ou `shopify`: qualquer outra recebia recusa do banco, e a saída era alterar a restrição na instalação, com o risco de uma atualização futura parar no meio quando a lista mudasse.

Agora existe uma origem genérica, `external`, para quem chega por integração própria, com o nome da plataforma no `payload` do pedido. A mesma entrada serve qualquer loja sem precisar de migration nova a cada caso, os três conectores nativos continuam exatamente como estavam, e a guarda não caiu: valor fora do vocabulário continua sendo recusado.

Para usar: grave o pedido com `external_provider = 'external'` e a plataforma em `payload` (por exemplo `{"platform": "tray"}`). Como a chave única do pedido é organização + origem + `external_id`, namespaceie o id vindo da plataforma (por exemplo `tray:10231`) para dois pedidos de plataformas diferentes não disputarem a mesma linha.

Contribuição de @webtecnica (#2670).
