---
impacto: nada_mudou
secao: corrigido
titulo: Gerar novos códigos de recuperação passa a pedir o código do aplicativo
---

Em Configurações › Segurança, gerar novos códigos de recuperação agora exige
que a sessão já tenha confirmado o código de 6 dígitos do aplicativo
autenticador — a mesma regra que já valia para desligar a verificação em duas
etapas. Se a sessão ainda não confirmou, a tela leva a pessoa para digitar o
código e depois volta para Segurança.

A mesma regra passa a valer para cadastrar um novo aplicativo autenticador em
uma conta que já tem um. O primeiro cadastro não muda.

Os códigos de recuperação passam a ser lidos e gravados só pelo servidor da
instalação, e o cadastro de um aplicativo autenticador troca o conjunto
anterior: os códigos mostrados na tela são os únicos que valem. Sem a chave de
serviço configurada, cadastrar a verificação e gerar códigos avisam que não foi
possível, em vez de seguir sem guardar os códigos.
