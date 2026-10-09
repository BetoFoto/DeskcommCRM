-- manifest: Pedidos de plataforma SEM integração nativa (Tray, Loja Integrada, WooCommerce…) entram por uma ORIGEM GENÉRICA — issue #2442. `orders_external_provider_check` só aceitava 'nuvemshop', 'vtex' e 'shopify', e a loja da instalação vende pelo site em Tray: a ponte própria grava direto em `orders` e batia 23514, obrigando a alterar a restrição NA INSTALAÇÃO — com o risco apontado na issue de uma migration futura recriar essa lista sem 'tray' e a atualização para no meio (as linhas já gravadas violam o CHECK novo). A opção 2 da issue (a que o autor prefere): 'external' como origem de quem chega por integração própria, com o NOME DA PLATAFORMA no `payload` (`payload->>'platform'`), para servir qualquer loja sem a lista crescer a cada caso. Alargamento puro — um CHECK que aceita MAIS valores não pode violar linha que já passava, então não há backfill; os três conectores nativos seguem idênticos e a guarda continua de pé (valor fora da lista ainda recebe 23514, coberto por `tests/invariants/pedido-de-plataforma-sem-conector.test.ts`). `drop constraint if exists` antes do `add` porque o nome existe desde a definição inicial da tabela no dump do install, e o MESMO bloco entra como apêndice em `supabase/baseline.sql` — é o que o kit self-host aplica (install E update), e este é o bloco único desta constraint, na regra da issue #159.
alter table public.orders
  drop constraint if exists orders_external_provider_check;

alter table public.orders
  add constraint orders_external_provider_check check (external_provider in (
    'nuvemshop', 'vtex', 'shopify', 'external'
  ));
