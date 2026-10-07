---
impacto: nada_mudou
secao: corrigido
titulo: Uma VPS com processador diferente das imagens publicadas também consegue atualizar pelo caminho normal
---

Quem numera o CRM numa VPS cuja arquitetura não é a das imagens que saem do CI (Oracle Ampere, por exemplo) via a atualização falhar sem recuperação: o registro respondia que não tinha a imagem para o processador da máquina e o sistema seguia na versão antiga, sem aviso. Pelo botão "Atualizar" do site era pior — o comando roda sozinho e ninguém via a falha. O kit já se reconstruía sozinho nesse caso, mas só depois que o `docker compose up -d` morria, e o `app` era a única das nossas imagens sem a saída de emergência ao lado da imagem publicada: um `docker compose up -d` rodado à mão, que é a dica que os próprios avisos ensinam, falhava com "No such image". Agora as quatro imagens nossas (app, worker, scheduler e agente de voz) têm imagem publicada E construção local lado a lado no compose de produção, e as mensagens do `install.sh` e do `update.sh` dizem o que a máquina vai fazer em vez de prometer o que não depende mais dela. Nada muda na instalação que já funciona: quem tem a imagem pronta continua só baixando, e a construção continua acontecendo só quando o registro não serve a plataforma.
