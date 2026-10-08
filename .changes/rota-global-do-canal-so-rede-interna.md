---
impacto: nada_mudou
secao: alterado
titulo: A rota global do webhook do WhatsApp só atende a rede interna da stack
---

A rota global do webhook do WhatsApp (`/api/v1/webhooks/waha`, sem token) é a
que o WAHA da própria stack chama pela rede interna do Docker. Agora a própria
aplicação responde 404 nessa rota a requisições que chegam por um proxy de
borda, qualquer que seja o proxy da instalação.

O WAHA da stack segue entregando as mensagens como antes. Integrações fora do
servidor continuam usando a rota com token (`/api/v1/webhooks/waha/<token>`),
que não muda. Não é preciso fazer nada.
