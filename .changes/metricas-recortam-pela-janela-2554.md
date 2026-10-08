---
impacto: nada_mudou
secao: corrigido
titulo: Os quadros "Performance por atendente" e "Por canal" deixam de ler o histórico inteiro a cada visita
---

Os dois quadros de Métricas mostram os últimos 30 dias, mas liam todas as conversas da empresa desde o início para calcular esse período. Agora só as conversas do período entram na conta, e os números mostrados não mudam. Quanto mais antigo o histórico da empresa, maior o ganho. Em empresas com muito volume dentro dos próprios 30 dias, os quadros ainda podem demorar ou passar do limite de 8 segundos do banco e mostrar erro; isso segue em acompanhamento na issue #2514. Nada precisa ser feito ao atualizar: a mudança de banco vem na própria atualização. Contribuição de @webtecnica (#2554), a partir da issue #2514.
