---
impacto: nada_mudou
secao: corrigido
titulo: As métricas de cada atendimento da IA voltam a ser gravadas
---

Desde a 1.77, todo atendimento concluído pela IA registrava no log do `worker` o erro "métricas do run não registradas", e as métricas daquele atendimento (chamadas, tokens, custo, latência, espera na fila e tempo total) não eram gravadas. O alerta de aproveitamento de cache, que é avaliado logo depois, também deixava de rodar. O atendimento em si não era afetado: o cliente recebia a resposta normalmente, e as telas de custo e uso, que leem o registro de cada chamada à IA, não perderam dado. Agora as métricas voltam a ser gravadas e o alerta volta a ser avaliado. As métricas dos atendimentos feitos entre a 1.77 e esta versão não são recuperadas: esse intervalo fica sem elas. Nada a fazer na atualização. Contribuição de @jmpo (#2617).
