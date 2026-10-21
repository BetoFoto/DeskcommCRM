---
impacto: capacidade_nova
secao: adicionado
titulo: O agente consulta os imóveis de um site WordPress com ACF pelo banco externo
---

Em Integração de dados, uma conexão MySQL com um site WordPress que usa o plugin ACF ganha a receita pronta "Imóveis do WordPress com ACF". O agente passa a responder no WhatsApp com os imóveis publicados: título, preço, quartos, bairro e, se o administrador mapear, cidade e área. A busca do cliente ("apartamentos de 2 quartos na Asa Norte até 600 mil") vira filtro na consulta: por bairro, por número de quartos, por preço máximo e por cidade. O preço é entendido no formato que o site usa — "650.000,00", "480000" ou "R$ 650.000,00" — e imóvel sem preço não entra em busca por teto. A receita só lê as tabelas que o administrador liberou na conexão e respeita o limite de linhas dela. Fica desligada até alguém adicioná-la à conexão; nada muda para quem não usa o banco externo.
