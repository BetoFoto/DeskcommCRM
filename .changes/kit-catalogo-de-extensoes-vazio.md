---
impacto: nada_mudou
secao: corrigido
titulo: O instalador de extensões recusa um catálogo baixado vazio também no Ubuntu 22.04
---

Quando o download do catálogo de extensões chegava vazio, o `extensao.sh` recusava o arquivo nas máquinas com `jq` 1.7. No `jq` 1.6, que é a versão do Ubuntu 22.04, ele aceitava o arquivo vazio como válido. Agora o arquivo vazio é recusado antes de o `jq` ler, em qualquer versão. Nada precisa ser feito ao atualizar. Contribuição de @daviguerreiroa (#2608).
