---
impacto: capacidade_nova
secao: adicionado
titulo: O agente consulta os imóveis de um site WordPress com ACF ou JetEngine pelo banco externo
---

Em Integração de dados, uma conexão MySQL com um site WordPress que usa o plugin ACF, ou o JetEngine no modo padrão de tipo de post, ganha a receita pronta "Imóveis do WordPress (ACF ou JetEngine)". O agente passa a responder no WhatsApp com os imóveis publicados: título, código, preço, aluguel, condomínio, quartos, suítes, banheiros, vagas, área e link.

A tela deixa de exigir que o bairro, a cidade, o tipo e a finalidade sejam campos do site: cada um desses dados pode estar guardado como **categoria** (as categorias do WordPress, com a hierarquia "Cidade › Bairro") ou como campo, e o administrador escolhe. É o que faltava para a receita funcionar num cadastro real de imobiliária — antes ela devolvia zero imóveis quando o bairro era categoria. A busca do cliente ("apartamentos de 2 quartos na Asa Norte até 600 mil") vira filtro na consulta: por bairro, por cidade, por tipo, por finalidade (venda ou aluguel), por número de quartos, por vagas, por preço máximo e por aluguel máximo.

Imóvel só de aluguel aparece na lista, e imóvel vendido ou alugado não é oferecido: a tela tem um bloco "Esconder imóveis" onde se aponta o campo da situação e os valores que somem (por padrão, "vendido, alugado"). O preço é entendido no formato que o site usa — "650.000,00", "650,000.00", "480000" ou "R$ 650.000,00" — e imóvel sem preço não entra em busca por teto. A receita só lê as tabelas que o administrador liberou na conexão (as tabelas de categoria só entram quando alguma categoria é usada) e respeita o limite de linhas dela. Fica desligada até alguém adicioná-la à conexão; nada muda para quem não usa o banco externo.
