---
impacto: nada_mudou
secao: corrigido
titulo: O modelo econômico das classificações não troca mais para um modelo que o teto de gastos não consegue contar
---
As duas classificações curtas de cada atendimento (etapa do funil e tentativa de manipular a IA) usam o modelo mais econômico do mesmo provedor. Numa organização que limitou os modelos permitidos e deixou habilitado só um modelo barato que a tabela de preços do produto não conhece (por exemplo, o GPT-5 Mini sem o GPT-5.6 Luna nem o GPT-5.4 Nano), a troca ia para esse modelo, o custo dessas chamadas ficava em branco e o teto de gastos deixava de contá-las. Agora, quando o modelo de antes tem preço conhecido, o econômico só é escolhido entre os que também têm; sem nenhum, as classificações ficam no modelo de antes. A tela de IA › Provedores segue a mesma regra e mostra o modelo que de fato roda. Em IA › Execuções, a linha de falha do modelo econômico coberta pela repetição deixou de afirmar que nada se perdeu, porque ela é gravada antes de a repetição terminar; o resultado da repetição aparece numa linha própria. Não é preciso fazer nada na instalação.
