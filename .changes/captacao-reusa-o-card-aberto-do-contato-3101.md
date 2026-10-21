---
impacto: capacidade_nova
secao: adicionado
titulo: O envio de formulário para de abrir um segundo card para o mesmo contato
---
Quando um formulário do site (ou qualquer fonte de webhook) manda um envio de alguém que já tem um card aberto no mesmo funil, a captação abria um card novo — e o mesmo cliente acabava com dois ou três cards abertos, sem ninguém saber qual deles é o de verdade. Na tela da fonte de webhook há uma opção nova, "Reaproveitar o card aberto do contato", e ela vem desligada: ligada, o envio atualiza o card que já existe — os campos que mudaram e a etapa da fonte — em vez de abrir outro. Nada a fazer na atualização: quem não ligar a opção continua com o comportamento de sempre.

Implementado por @webtecnica (#3174).
