---
impacto: capacidade_nova
secao: adicionado
titulo: O agente de IA pode usar o servidor de ferramentas externo também durante o atendimento, com a identidade do cliente enviada pelo sistema
---

Na tela do agente, quem é admin encontra a opção "Usar o servidor de ferramentas externo durante o atendimento". Ligada, o servidor MCP externo registrado pela organização (um ERP, por exemplo) passa a valer também nas conversas com clientes, e cada pedido a ele leva três cabeçalhos montados pelo sistema a partir do cadastro: `X-Deskcomm-Contato-Id`, `X-Deskcomm-Contato-Telefone` e `X-Deskcomm-Canal`. O servidor externo deve filtrar os dados por esses cabeçalhos e ignorar qualquer identificador que venha da conversa. Cada chamada feita em atendimento fica registrada com o contato da conversa.

A opção vem desligada em todo agente: sem ligá-la, nada muda. Detalhes em `docs/features/servidor-mcp-externo.md`.

Issue #2147, a partir da proposta de @brunno-soaress.
