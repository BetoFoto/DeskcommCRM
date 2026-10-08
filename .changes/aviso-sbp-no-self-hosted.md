---
impacto: nada_mudou
secao: corrigido
titulo: Instalação com o Supabase na própria VPS deixa de pedir um token do Supabase na nuvem
---

Quem instalava com o banco na própria VPS via, no meio da instalação, o aviso
"sem SUPABASE_ACCESS_TOKEN" e a instrução de buscar um token `sbp_...` em
supabase.com. Esse token é do Supabase na nuvem e não serve para o Supabase da
VPS, onde os e-mails de acesso já ficam configurados pelo próprio instalador.

Agora, nessa instalação, o passo dos e-mails confere que eles já usam os modelos
do CRM e diz isso; se ainda não usarem, manda rodar o `update.sh`. Quem usa o
Supabase na nuvem continua recebendo o aviso do token, que ali é o passo certo.
Não é preciso fazer nada.
