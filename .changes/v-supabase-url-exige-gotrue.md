---
impacto: nada_mudou
secao: corrigido
titulo: O instalador só aceita o endereço do Supabase quando quem responde é o Supabase
---

Ao conferir o endereço do Supabase, o instalador aceitava qualquer servidor que
respondesse. Numa VPS com outro painel (como o Coolify) na mesma porta, ou com o
endereço do site da empresa colado no lugar, a instalação seguia apontando para
o lugar errado. Agora ele exige a resposta do serviço de login do Supabase e,
se for outro servidor, avisa na hora qual endereço respondeu e pede para conferir
o endereço e a porta. Supabase na nuvem e Supabase próprio continuam passando
como antes; não é preciso fazer nada.
