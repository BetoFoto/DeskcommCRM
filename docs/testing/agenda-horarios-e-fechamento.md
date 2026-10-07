# Evidência: horários locais e fechamento depois das ações

Medição de contribuição externa em 07/10/2026, base oficial `ce5b87a3c`.
Código candidato em worktree, sem implantação. Dados, contatos, canal e banco
fictícios; nenhum envio por WhatsApp. O canal somente capturou mensagens.

## Causas reproduzidas

1. O bloco de reservas interpolava `Date` do PostgreSQL, apresentando a hora
   do processo em vez da hora local da reserva. Listagem e escrita das ferramentas
   também entregavam instantes sem rótulo local para as reservas existentes.
2. No SDK `ai@7.0.116`, `result.response.messages` é só a última etapa.
   O fechamento perdia as ações de etapas anteriores; `result.responseMessages`
   contém a fita completa. Isso foi observado no ensaio: criação confirmada no
   banco às 11h e mensagem correta, mas resumo "a reserva ainda não foi confirmada".
3. O bloco da abertura precede a ação. Na remarcação ele pode conservar 17h30
   depois de o escritor concluir a mudança para 17h. A releitura após as ações
   fornece a reserva vigente ao fechamento.

## Par agente e ferramenta, com o mesmo recorte

Motor `runAgentTurn` e ferramentas MCP nativas, modelo real configurado pela
instalação (`gpt-5.6-luna`), dois turnos por cenário. Consulta direta de
`crm_list_appointments` antes e depois, mesmas organização e pessoa fictícias.
Escritores e funções do baseline executaram no PostgreSQL descartável.

| Cenário e pedido enviado                                                                                                 | Banco / ferramenta direta                      | Resposta e registro no turno seguinte                          |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------- |
| "Oi, pode confirmar que horas ficou meu design na sexta, dia 09/10?"                                                     | 17:00 UTC; `quando`: 14:00 São Paulo           | 09/10 às 14h; confirmado                                       |
| "Que horas ficou meu design na sexta?", resumo anterior dizia 17h                                                        | 17:00 UTC; `quando`: 14:00 São Paulo           | 14h; resumo antigo corrigido; preferência preservada           |
| "Pode reservar meu design de sobrancelhas na sexta, dia 09/10, às 11h, por favor. Meu nome completo é Cliente Fictícia." | Criação confirmada às 14:00 UTC / 11:00 local  | 11h; reserva confirmada, sem repetir criação como próxima ação |
| "Pode mudar meu design de sexta, dia 09/10, de 17h30 para 17h, por favor."                                               | Revisão 2, 20:00 UTC / 17:00 local             | 17h; remarcação concluída                                      |
| "Cancele meu design de sexta, dia 09/10, por favor. Não vou conseguir ir."                                               | Cancelado, revisão 2; sem reserva futura ativa | Cancelamento confirmado; sem oferecer a reserva como ativa     |

O segundo pedido foi "Só para confirmar: para que dia e horário ficou marcado?",
ou, no cancelamento, "Só para confirmar: meu horário foi cancelado mesmo?".
Mensagens, dados persistidos, ferramenta direta e registros de ambos os turnos
foram conferidos. Resultado semântico: cinco cenários coerentes nos dois turnos.

Uma asserção inicial exigia `commitments: []` após cancelar. O modelo registrou
"o design está cancelado" nesse campo, o que é coerente e não significa reserva
ativa. A asserção foi corrigida para admitir a confirmação do cancelamento;
a repetição isolada passou. Não se contou uma alteração de asserção como conserto
no produto.

## Limites da evidência

- A fronteira Supabase foi uma ponte SQL de teste, com filtros, ordenação,
  JSON e funções reais. Não mede HTTP PostgREST nem uma sessão autenticada
  de navegador. Os testes nativos de isolamento medem esses recortes à parte.
- Foi usado o prompt publicado autorizado pelo operador; fontes de conhecimento,
  roteadores, handoff, casos e operação secundária não foram copiados. Esta é
  evidência do núcleo de agenda e fechamento, não reprodução integral da instalação.
- A prova por interface e o transporte WhatsApp não foram medidos. Ficaram
  para o mantenedor, conforme o guia de contribuição externa.
- A hora fornecida é determinística, mas mensagens e resumo continuam gerados
  pelo modelo. Cinco cenários não provam ausência de todo erro futuro.
- Não houve migração, alteração de configuração ou edição de reservas reais.

## Gates e sabotagem

Resultados e comandos serão preenchidos após as verificações finais.
