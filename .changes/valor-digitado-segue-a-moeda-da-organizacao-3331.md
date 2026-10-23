---
impacto: nada_mudou
secao: corrigido
titulo: Numa organização em dólar, digitar 1,300 no valor do negócio deixa de virar 1,30
---

Em organização cuja moeda não é o real, o campo de valor do funil passa a ler o número digitado na convenção DESSA moeda. No dólar, `1,300` é mil e trezentos — antes virava 1,30, cem vezes menos, e ia assim para o funil e os relatórios —, e `1.300` é um e trinta. O mesmo vale para o campo personalizado de moeda e para o eco que aparece embaixo do campo, que continua mostrando o valor entendido antes de salvar.

Nada muda em real, e nada muda para os preços de catálogo, honorários, comandas e faturamento, que não têm a moeda da organização em mãos.

Fica declarado o que NÃO se resolve: vírgula com dois dígitos depois (`1,30`) continua sendo lida como 1,30 em qualquer moeda, porque dois dígitos não são grupo de milhar em convenção nenhuma. Quem quiser dizer 130 dólares digita `130` ou `1.30`.

Nada a fazer na atualização.

Contribuição de @webtecnica (#3365).
