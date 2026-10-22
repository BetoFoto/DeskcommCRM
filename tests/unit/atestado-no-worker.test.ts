/**
 * O ATESTADO NO WORKER — a ordem, o escopo da falha e a evidência do ato.
 *
 * ─── Por que asserção de FONTE, e não de comportamento ──────────────────────
 *
 * É a mesma técnica de `lgpd-aviso-apos-apagar.test.ts` para a ordem do worker,
 * e pelos mesmos dois motivos: (1) a ordem — ler a identidade ANTES da cascata,
 * emitir DEPOIS — é o que a cascata destrói (o passo 1 zera `email`,
 * `display_name`, `phone_number`), e rodar a cascata de verdade é o que o
 * invariante de banco (`tests/invariants/lgpd-aviso-do-artigo-12-so-fora-do-
 * brasil.test.ts`) já faz, com Postgres; (2) o que se quer travar aqui é o
 * CONTRATO que uma refatoração descuidada quebra em silêncio: emitir antes de
 * apagar, ou deixar a falha do papel derrubar o pedido do titular.
 *
 * O comportamento do módulo e do emissor é medido de verdade nos outros dois
 * arquivos (`atestado-de-anonimizacao.test.tsx` e
 * `atestado-de-anonimizacao-emissao.test.ts`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fonte = readFileSync(join(process.cwd(), "workers", "lgpd-redact-worker.ts"), "utf8");
const rotaAprovar = readFileSync(
  join(process.cwd(), "app", "api", "v1", "lgpd", "requests", "[id]", "approve", "route.ts"),
  "utf8",
);
const rotaAtestado = readFileSync(
  join(process.cwd(), "app", "api", "v1", "lgpd", "requests", "[id]", "atestado", "route.ts"),
  "utf8",
);

const leitura = fonte.indexOf("cascadeRedactContact({");
const emissao = fonte.indexOf("emitirAtestadoDeAnonimizacao(admin");

describe("a ordem no worker", () => {
  it("lê a identidade do titular (nome, contatos e documento) ANTES da cascata", () => {
    const identidade = fonte.indexOf('select("email, display_name, phone_number, custom_fields, cpf_hash")');
    expect(identidade, "o worker não lê mais a identidade do titular").toBeGreaterThan(-1);
    expect(identidade, "a leitura da identidade saiu de antes da cascata").toBeLessThan(leitura);
  });

  it("emite o atestado DEPOIS da cascata — nunca antes do apagamento", () => {
    expect(emissao, "o worker não emite mais o atestado").toBeGreaterThan(-1);
    expect(
      emissao,
      "o atestado passou a ser emitido antes da cascata: o papel diria que apagou sem ter apagado",
    ).toBeGreaterThan(leitura);
  });

  it("o atestado entra no RESULTADO do pedido, não num log perdido", () => {
    expect(fonte).toContain("...(atestadoDoPedido ? { atestado: atestadoDoPedido } : {}),");
  });

  it("a falha do papel NÃO derruba o pedido: fica em `result.atestado.erro` e no log", () => {
    expect(fonte).toContain("atestadoDoPedido = { erro: motivo };");
    expect(fonte).toContain('logger.warn("lgpd: atestado de anonimização não emitido"');
    // A emissão tem de estar DENTRO do try: emitir fora dele devolveria a falha
    // ao dispatcher e o pedido do titular viraria `failed` por causa do papel.
    const tryAntes = fonte.lastIndexOf("try {", emissao);
    expect(tryAntes, "a emissão do atestado saiu de dentro do try").toBeGreaterThan(-1);
    const catchDepois = fonte.indexOf("catch (erroDoAtestado)", emissao);
    expect(catchDepois, "a emissão perdeu o catch").toBeGreaterThan(emissao);
  });

  it("o aviso do art. 12.º continua com a guarda do país — o atestado não a desfez", () => {
    expect(fonte).toContain("const avisaTitular = perfil.codigo !== PAIS_PADRAO;");
  });
});

describe("a evidência do ato é capturada onde ela existe: na requisição", () => {
  it("a rota de aprovação grava o IP, o autor e o instante no pedido", () => {
    expect(rotaAprovar).toContain("ip: ipDoCliente(req.headers),");
    expect(rotaAprovar).toContain("user_agent: req.headers.get(\"user-agent\"),");
    expect(rotaAprovar).toContain("user_id: authUser.id,");
    expect(rotaAprovar).toContain("execucao: evidenciaDaExecucao,");
    // O IP é dado de pessoa identificável: entra no pedido, e NÃO na trilha.
    expect(rotaAprovar).not.toContain("ip: ipDoCliente(req.headers)\n    },\n    metadata");
  });

  it("a rota do atestado exige admin e assina URL curta", () => {
    expect(rotaAtestado).toContain('requireRole("admin"');
    expect(rotaAtestado).toContain("createSignedUrl(atestado.path, EXPIRA_EM_SEGUNDOS)");
    expect(rotaAtestado).toContain("EXPIRA_EM_SEGUNDOS = 900");
  });
});
