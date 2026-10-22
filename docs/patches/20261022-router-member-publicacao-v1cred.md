# Publicação de especialistas ligados ao Intent Router sem número individual
A correção atua no formulário, na regra pura e na função SQL de publicação.
Ela **não é um atalho**: o servidor exige vínculo válido e canal WORKING na organização; não publica agente sem número e sem roteador.

## Comportamento
- Agente comum, canal vazio: continua bloqueado.
- Especialista associado a roteador válido, canal do roteador WORKING: botão habilita, versão sem canal próprio publica.
- Roteador INATIVO continua inativo. Membros com `channel_session_id = NULL` não são candidatos de atendimento direto por sessão. Só um roteador posteriormente ativo poderá selecioná-los por ID.
- Canal do roteador offline, credencial inválida ou alterações não salvas: recusados.
- Nenhuma publicação ou atualização de produção faz parte deste PR.

## Evidências, testes e limites
Código derivado de `melgarafael/DeskcommCRM` na base do fork de 22/10/2026, com proteção de organização e retorno dos erros existentes.
Testes adicionados: unitários da regra de publicação e invariantes de banco (router inativo + canal WORKING; canal STOPPED; agente sem vínculo continua recusado).
**A executar no CI:** `npx vitest run lib/ai/agents/bloqueio-de-publicacao.test.ts`, `npm run test:db -- tests/invariants/rascunho-de-agente-sem-numero.test.ts` conforme scripts reais, typecheck e testes e2e.
**Pendência antes de MERGE:** sincronizar `supabase/baseline.sql` de maneira idempotente com a versão final da função (arquivo ~3,2 MB); validar ordenação de migrations e nomes; simular publicação sem canal individual e verificar ausência de resposta direta no 7551.
**Rollback:** a partir de migration de reversão com o corpo anterior da função (0592), não apagar versões publicadas nem manipular mensagens. A versão publicada sem canal permanecerá inatingível por sessão direta, e o router deve permanecer inativo durante rollback. Não fazer deploy antes de ter backup, revisão e smoke tests.

## Aplicação V1CRED
Os três agentes V2.2 foram salvos como rascunhos na organização v1cred. Não escolher o 7551 individualmente para forçar o publish, nem mexer no 2277. Após revisão e deploy autorizado, publicar especialistas no editor, validar os 14 cenários de homologação, verificar ANA v5 e fallback; ativar router somente em autorização separada.
