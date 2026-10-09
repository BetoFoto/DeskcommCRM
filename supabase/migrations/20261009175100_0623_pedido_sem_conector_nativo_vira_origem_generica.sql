-- manifest: Pedidos de plataforma SEM integração nativa (Tray, Loja Integrada, WooCommerce…) entram por uma ORIGEM GENÉRICA — issue #2442. `orders_external_provider_check` só aceitava 'nuvemshop', 'vtex' e 'shopify', e a loja da instalação vende pelo site em Tray: a ponte própria grava direto em `orders` e batia 23514, obrigando a alterar a restrição NA INSTALAÇÃO — com o risco apontado na issue de uma migration futura recriar essa lista sem 'tray' e a atualização para no meio (as linhas já gravadas violam o CHECK novo). A opção 2 da issue (a que o autor prefere): 'external' como origem de quem chega por integração própria, com o NOME DA PLATAFORMA no `payload` (`payload->>'platform'`), para servir qualquer loja sem a lista crescer a cada caso. Alargamento, com um backfill: linha gravada com origem fora da lista por instalação que alargou a restrição à mão (o caso da issue) vira 'external', com a plataforma em `payload->>'platform'` e o `external_id` prefixado ('tray:10231') — sem isso o `add constraint` recebe 23514 e o update.sh (sem ON_ERROR_STOP) deixa a instalação sem guarda; os três conectores nativos seguem idênticos e a guarda continua de pé (valor fora da lista ainda recebe 23514, coberto por `tests/invariants/pedido-de-plataforma-sem-conector.test.ts`). `drop constraint if exists` antes do `add` porque o nome existe desde a definição inicial da tabela no dump do install, e o MESMO bloco entra como apêndice em `supabase/baseline.sql` — é o que o kit self-host aplica (install E update), e este é o bloco único desta constraint, na regra da issue #159.
alter table public.orders
  drop constraint if exists orders_external_provider_check;

-- Entre o `drop` e o `add` (a restrição alargada à mão ainda recusaria
-- 'external'), a linha que a instalação gravou com uma origem fora da lista
-- (o caso da própria #2442, 'tray'). Sem isto o
-- `drop` vale, o `add` recebe 23514 e — como o update.sh aplica o baseline sem
-- ON_ERROR_STOP — a instalação fica SEM guarda nenhuma, com o erro repetido a
-- cada atualização. A linha vira a origem genérica no formato que a ponte deve
-- usar daqui em diante: a plataforma vai para `payload->>'platform'` (sem
-- sobrescrever uma que já esteja lá) e o `external_id` ganha o prefixo dela
-- ('tray:10231'), que é o que mantém a chave única — o par (origem, id) já era
-- único, então (external, origem:id) também é. Idempotente: na segunda passada
-- não sobra linha fora da lista.
update public.orders
   set payload = jsonb_build_object('platform', external_provider) || payload,
       external_id = external_provider || ':' || external_id,
       external_provider = 'external'
 where external_provider not in ('nuvemshop', 'vtex', 'shopify', 'external');

alter table public.orders
  add constraint orders_external_provider_check check (external_provider in (
    'nuvemshop', 'vtex', 'shopify', 'external'
  ));
