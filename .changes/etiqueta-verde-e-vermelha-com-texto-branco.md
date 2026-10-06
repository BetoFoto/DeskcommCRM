---
impacto: nada_mudou
secao: corrigido
titulo: Etiquetas verde-água e vermelha passam a sair com texto branco, inclusive as que já tinham cor
---

Os dois tons da paleta de etiquetas que saíam com texto preto sobre fundo forte foram escurecidos: o verde-água passa de `#12a594` para `#00655a` e o vermelho de `#e54d2e` para `#cf3716`. Nos dois, o texto do chip agora é branco, com contraste de 6,98 e 4,99. Os nomes e a fileira de cores na tela de Tags continuam os mesmos.

As etiquetas que já tinham sido pintadas com os tons antigos não precisam de nada: elas passam a ser lidas no tom novo, sem migration, e a tela de Tags abre com o tom certo marcado. Quem gravar um dos tons antigos pela API recebe o tom novo gravado. Nada muda na configuração.

Relatado por @Fabio-Ribeir0 (#2373). Contribuição de @webtecnica (#2380).
