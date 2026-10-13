---
impacto: nada_mudou
secao: corrigido
titulo: Endereço de servidor de e-mail inválido explica o formato, sem erro cru do banco
---

Na tela do servidor de e-mail (/admin/email), um endereço fora do formato — como o nome de um contêiner com "_" — era recusado pelo banco e o aviso mostrava o texto cru do Postgres. Agora a tela valida o endereço antes de salvar e explica em português o que está errado; qualquer outra falha de gravação também vira uma mensagem legível, e o texto técnico fica no log do servidor.

Contribuição de @Tong-bit-art (#2816), a partir da issue #2804.
