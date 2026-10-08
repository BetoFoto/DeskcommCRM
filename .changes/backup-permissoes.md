---
impacto: nada_mudou
secao: corrigido
titulo: Os backups passam a ser legíveis só pelo dono da VPS
---

O backup diário guardava a sessão do WhatsApp e os anexos dos clientes com uma
permissão que deixava qualquer usuário da máquina ler os arquivos — e a sessão
do WhatsApp é o pareamento do número inteiro. Conforme o jeito de chamar o
backup, o dump do banco e a pasta `backups/` também ficavam abertos.

Agora todo arquivo de backup sai legível só pelo dono, e a pasta `backups/`
fica fechada para os demais usuários já no próximo backup, inclusive com os
arquivos antigos dentro dela. Não é preciso fazer nada.
