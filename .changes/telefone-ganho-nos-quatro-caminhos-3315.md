---
impacto: capacidade_nova
secao: corrigido
titulo: Automação "contato ganhou telefone" passa a rodar também na ingestão, no cron e na mesclagem
---
A automação que dispara quando um contato passa a ter telefone só rodava quando o número era preenchido na tela ou na captura de anúncio. Os outros quatro caminhos que tiram a ficha do vazio — a ingestão de mensagens do canal, o cron que descobre o número por trás da identidade opaca, e a mesclagem de dois cadastros — gravavam o telefone sem avisar, e a automação não rodava. Agora rodam nos quatro, cada um emitindo uma única vez e só quando o contato estava mesmo sem número; a mesclagem emite para o cadastro que sobrevive. Quem já tinha número não gera evento nenhum, e a promoção da grafia de 12 para 13 dígitos do mesmo número também não é tratada como número novo.
