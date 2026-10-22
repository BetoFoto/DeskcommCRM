/**
 * O FILTRO DE PALAVRA-CHAVE **NO TURNO DE VERDADE** — o teste que o CR do
 * mantenedor no #2696 cobra explicitamente ("hoje o portão pode ser removido
 * inteiro com a suíte verde").
 *
 * Os testes puros (`filtro-de-palavra-chave-do-gatilho.test.ts`) provam a
 * decisão; nenhum deles prova a LIGAÇÃO. Este arquivo roda `runAgentTurn` — o
 * caminho de produção, com `getLeadContext` real, contexto real composto por
 * `corpoDaMensagem` e o portão no lugar em que ele mora — e mede o desfecho de
 * cada turno:
 *
 *  - FORA do filtro: o turno ENCERRA sem chegar ao modelo (resolve, e o log do
 *    portão aparece). Remover o portão faz este caso virar `/config LLM/` —
 *    VERMELHO, que é a cerca que faltava.
 *  - DENTRO do filtro: o turno segue até a primeira chamada de modelo, que
 *    para por falta de config de LLM na org (`/config LLM/`). É o mesmo ponto
 *    de parada de `turno-le-em-paralelo.test.ts`, e é o que prova que o turno
 *    NÃO foi calado.
 *
 * Os três pontos do CR, um por bloco:
 *
 *  1. ORDEM (ponto 1): pedido de atendente e opt-out ambíguo SEM a palavra do
 *     filtro continuam sendo tratados — passagem para humano, item na Central
 *     (é o que `performHumanHandoff` faz) e aviso ao lead. O portão roda
 *     DEPOIS deles; movê-lo de volta para cima deixa estes casos VERMELHOS.
 *  2. MÍDIA (ponto 2): áudio sem transcrição chega como `[audio]`, nunca como
 *     `null` — a falha aberta tem de rodar com essa régua.
 *  3. RAJADA (ponto 3): o drain coalesce a 2ª mensagem no job da 1ª, então
 *     "oi" + "quero um orçamento" tem de entrar pelo conjunto.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { lerFiltroDePalavraChave } from "@/lib/agent-engine/agent/palavra-chave-do-gatilho";

const mocks = vi.hoisted(() => ({
  passagem: vi.fn(),
  emHandoff: vi.fn(),
  aviso: vi.fn(),
  cancel: vi.fn(),
}));

// Só os EFEITOS do handoff são dublados (CRM da Central, aviso pelo canal,
// crons). As detecções em si (`detectHumanHandoffRequest`,
// `detectAmbiguousOptOut`) seguem as REAIS: o que se prova aqui é a ordem, e
// uma detecção dublada provaria nada.
vi.mock("@/lib/agent-engine/agent/human-handoff", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isLeadInHandoff: mocks.emHandoff,
  performHumanHandoff: mocks.passagem,
}));
vi.mock("@/lib/agent-engine/agent/aviso-de-escalacao", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  avisarLeadDaEscalacao: mocks.aviso,
}));
vi.mock("@/lib/agent-engine/cron/scheduler", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cancelPendingCronsForLead: mocks.cancel,
}));

import { runAgentTurn } from "@/lib/agent-engine/agent/inbound-turn";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const CANAL = "44444444-4444-4444-8444-444444444444";
const JOB = "55555555-5555-4555-8555-555555555555";
const MENSAGEM = "66666666-6666-4666-8666-666666666666";

/** O filtro que a tela grava — a mesma leitura da versão publicada. */
const FILTRO = lerFiltroDePalavraChave({
  events: ["message"],
  filters: { ignore_groups: true, ignore_self: true, keyword_regex: "orçamento|pedido" },
})!;

interface Linha {
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  media_url: string | null;
  media_storage_path: string | null;
  media_mime: string | null;
  media_derived_text: string | null;
  sent_at: Date;
}

/** Mensagem de texto como a linha do banco a devolve. */
function texto(direction: Linha["direction"], body: string, minutos: number): Linha {
  return {
    direction,
    type: "text",
    body,
    media_url: null,
    media_storage_path: null,
    media_mime: null,
    media_derived_text: null,
    sent_at: new Date(Date.UTC(2026, 9, 6, 15, minutos)),
  };
}

/** Áudio SEM transcrição: `body` NULL, conteúdo só no derivado (que ainda não veio). */
function audioSemTranscricao(minutos: number): Linha {
  return {
    direction: "inbound",
    type: "audio",
    body: null,
    media_url: "https://cdn.example/audio.ogg",
    media_storage_path: null,
    media_mime: "audio/ogg",
    media_derived_text: null,
    sent_at: new Date(Date.UTC(2026, 9, 6, 15, minutos)),
  };
}

const LINHA_DO_CONTATO = {
  name: "Cliente",
  display_name: null,
  email: null,
  phone_number: "5511999999999",
  tags: [],
  is_blocked: false,
  is_personal: false,
  source: "whatsapp",
  consent: null,
  is_anonymized: false,
};

/**
 * Pool fingido com o formato de CADA consulta que a abertura faz:
 *
 *  - contato e histórico seguem o SQL real (a abertura é a REAL, então o
 *    contexto — e o corpo composto — vêm de `getLeadContext`);
 *  - a linha fixada no job (`and id = $3`) é a que o turno responde.
 */
function poolCom(historico: Linha[], fixada: Linha | null) {
  return {
    query: vi.fn(async (sql: string) => {
      if (/from contacts where organization_id = \$1 and id = \$2/.test(sql)) {
        return { rows: [LINHA_DO_CONTATO] };
      }
      if (sql.includes("from messages") && /and id = \$3/.test(sql)) {
        return { rows: fixada === null ? [] : [fixada] };
      }
      if (sql.includes("from messages") && sql.includes("media_mime")) {
        // O produtor pede DESC e inverte — devolve DESC, como o banco.
        return { rows: [...historico].reverse() };
      }
      // A camada plataforma do playbook é obrigatória para o turno abrir
      // (`loadPlaybook` recusa sem ela) — sem esta linha todo turno morre na
      // abertura e nenhum dos desfechos abaixo seria medido.
      if (sql.includes("playbook_pointers")) {
        return { rows: [{ layer: "platform", version_id: "v1", content: "plataforma" }] };
      }
      return { rows: [] };
    }),
  } as never;
}

function logFalso() {
  const info = vi.fn();
  return { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn(), infoChamado: info };
}

async function turno(
  pool: never,
  filtro: RegExp | null,
  log: ReturnType<typeof logFalso>,
  /**
   * #3142 — o "já engajado" que a resolução do turno entrega
   * (`agenteJaEngajado`, o sticky do roteador). `false` = ENTRADA da conversa:
   * é o que os casos do #2696 acima medem, sem mudança.
   */
  engajado = false,
): Promise<void> {
  const job = {
    id: JOB,
    organization_id: ORG,
    contact_id: CONTATO,
    kind: "inbound_turn",
    payload: {},
    attempts: 1,
    claimed_by: "w",
    claimed_at: new Date(),
  };
  const deps = {
    log,
    llmCfg: {},
    crmCfg: {},
    knobs: { maxSteps: 1 },
    clock: () => new Date("2026-10-06T15:00:00Z"),
    // Seam de canal: nenhum adapter real, e o aviso de escalação é dublado.
    channel: () => ({ send: vi.fn(async () => ({ kind: "sent" })) }),
  };
  await runAgentTurn(deps as never, job as never, pool, { workerId: "w" }, {
    resolvedAgent: {
      config: {
        agentId: "agente-1",
        versionId: "v1",
        operationMode: "automatic",
        pausedAt: null,
        systemPrompt: "persona",
        toolIds: [],
        casesEnabled: false,
        historyMessageWindow: 20,
        historyTokenWindow: 1000,
        handoffKeywords: [],
        filtroDePalavraChave: filtro,
      },
      routerId: null,
      intentName: null,
      confidence: null,
      outcome: "fallback",
      agenteJaEngajado: engajado,
    },
    channelSessionId: CANAL,
    conversationId: CONVERSA,
    inboundMessageId: MENSAGEM,
    buildOpening: () => "",
  } as never);
}

const mensagensDeLog = (log: ReturnType<typeof logFalso>): string[] =>
  log.infoChamado.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.emHandoff.mockResolvedValue(false);
  mocks.aviso.mockResolvedValue({ avisado: true });
  mocks.passagem.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(0);
});

describe("turno REAL — o filtro que PARA e o que SEGUE", () => {
  it("mensagem fora do filtro: o turno encerra, sem chegar ao modelo", async () => {
    const log = logFalso();
    const pool = poolCom(
      [texto("outbound", "Oi! Como posso ajudar?", 0), texto("inbound", "camiseta azul, tamanho M", 3)],
      texto("inbound", "camiseta azul, tamanho M", 3),
    );

    // Resolve (não chega a `/config LLM/`): o portão encerrou o turno.
    await expect(turno(pool, FILTRO, log)).resolves.toBeUndefined();
    expect(mensagensDeLog(log).some((m) => m.includes("turno pulado"))).toBe(true);
    expect(mocks.passagem, "nada aqui pede humano").not.toHaveBeenCalled();
  });

  it("mensagem COM a palavra: o turno segue até o modelo (o portão não cala)", async () => {
    const pool = poolCom(
      [texto("outbound", "Oi! Como posso ajudar?", 0), texto("inbound", "quero um orçamento de camiseta", 3)],
      texto("inbound", "quero um orçamento de camiseta", 3),
    );

    // O ponto de parada é a primeira chamada de modelo, sem config de LLM na
    // org: chegar aqui é a prova de que o turno atravessou o portão.
    await expect(turno(pool, FILTRO, logFalso())).rejects.toThrow(/config LLM/);
  });

  it("CONTROLE — sem filtro nenhum a mesma mensagem segue (o portão não é o turno)", async () => {
    const pool = poolCom(
      [texto("outbound", "Oi!", 0), texto("inbound", "camiseta azul, tamanho M", 3)],
      texto("inbound", "camiseta azul, tamanho M", 3),
    );
    await expect(turno(pool, null, logFalso())).rejects.toThrow(/config LLM/);
  });
});

describe("ponto 3 do CR — a RAJADA é julgada pelo conjunto", () => {
  it("'oi' (a mensagem do job) + 'quero um orçamento' (coalescida) ENTRA", async () => {
    // O drain coalesce a segunda mensagem no job da primeira: a fixada é "oi".
    const pool = poolCom(
      [
        texto("outbound", "Oi! Como posso ajudar?", 0),
        texto("inbound", "oi", 3),
        texto("inbound", "quero um orçamento", 4),
      ],
      texto("inbound", "oi", 3),
    );

    // Lendo só a mensagem fixada ("oi"), o turno morria no portão.
    await expect(turno(pool, FILTRO, logFalso())).rejects.toThrow(/config LLM/);
  });

  it("rajada em que nenhuma mensagem casa continua parando", async () => {
    const log = logFalso();
    const pool = poolCom(
      [
        texto("outbound", "Oi!", 0),
        texto("inbound", "oi", 3),
        texto("inbound", "camiseta azul, tamanho M", 4),
      ],
      texto("inbound", "oi", 3),
    );
    await expect(turno(pool, FILTRO, log)).resolves.toBeUndefined();
    expect(mensagensDeLog(log).some((m) => m.includes("turno pulado"))).toBe(true);
  });
});

describe("ponto 2 do CR — mídia chega como [audio], não como null", () => {
  it("áudio sem transcrição atravessa o filtro (falha ABERTA da mídia roda)", async () => {
    const fixada = audioSemTranscricao(3);
    const pool = poolCom([texto("outbound", "Oi!", 0), fixada], fixada);

    // `corpoDaMensagem` compõe `[audio]`; se o portão testasse `corpo === null`,
    // este turno seria calado (era o defeito medido pelo mantenedor).
    await expect(turno(pool, FILTRO, logFalso())).rejects.toThrow(/config LLM/);
  });
});

describe("ponto 1 do CR — as detecções rodam ANTES do portão", () => {
  it("pedido de atendente sem a palavra do filtro: handoff acontece", async () => {
    const log = logFalso();
    const pool = poolCom(
      [texto("outbound", "Oi!", 0), texto("inbound", "quero falar com um atendente", 3)],
      texto("inbound", "quero falar com um atendente", 3),
    );

    // Antes do conserto o portão retornava primeiro: sem resposta, sem
    // passagem para humano e sem item na Central.
    await expect(turno(pool, FILTRO, log)).resolves.toBeUndefined();
    expect(mocks.passagem).toHaveBeenCalledTimes(1);
    expect(mocks.passagem.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ reason: "requested_human" }),
    );
    expect(mocks.aviso, "o lead tem de ser avisado da passagem").toHaveBeenCalledTimes(1);
    expect(mensagensDeLog(log).some((m) => m.includes("handoff humano acionado"))).toBe(true);
  });

  it("opt-out ambíguo sem a palavra do filtro: silencia e escala na Central", async () => {
    const pool = poolCom(
      [texto("outbound", "Oi!", 0), texto("inbound", "me deixa em paz", 3)],
      texto("inbound", "me deixa em paz", 3),
    );

    await expect(turno(pool, FILTRO, logFalso())).resolves.toBeUndefined();
    expect(mocks.passagem).toHaveBeenCalledTimes(1);
    expect(mocks.passagem.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ reason: "suspected_optout" }),
    );
    expect(mocks.aviso).toHaveBeenCalledTimes(1);
  });

  it("pedido de humano na RAJADA (2ª mensagem) também passa pelo portão", async () => {
    // A mesma fonte que o handoff usa — `inboundsPendentes` — é a que o filtro
    // lê: as duas perguntas não podem divergir.
    const pool = poolCom(
      [
        texto("outbound", "Oi!", 0),
        texto("inbound", "oi", 3),
        texto("inbound", "quero falar com uma pessoa", 4),
      ],
      texto("inbound", "oi", 3),
    );

    await expect(turno(pool, FILTRO, logFalso())).resolves.toBeUndefined();
    expect(mocks.passagem.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ reason: "requested_human" }),
    );
  });
});

describe("#3142 — o filtro decide a ENTRADA, não cada mensagem", () => {
  it("conversa JÁ ENGAJADA: mensagem fora do filtro NÃO cala o turno (o defeito medido)", async () => {
    // O exemplo do #2696: o agente respondeu "quero um orçamento", perguntou o
    // produto, e o cliente respondeu "camiseta azul, tamanho M" — sem nenhuma
    // palavra do filtro. Julgando cada mensagem, o agente ficava CALADO no meio
    // da conversa que ele mesmo começou.
    const log = logFalso();
    const pool = poolCom(
      [
        texto("outbound", "Quer um orçamento de quê?", 0),
        texto("inbound", "quero um orçamento", 1),
        texto("outbound", "Qual o produto?", 2),
        texto("inbound", "camiseta azul, tamanho M", 3),
      ],
      texto("inbound", "camiseta azul, tamanho M", 3),
    );

    // O ponto de parada é a primeira chamada de modelo (sem config de LLM na
    // org): chegar aqui é a prova de que o turno atravessou o portão.
    await expect(turno(pool, FILTRO, log, true)).rejects.toThrow(/config LLM/);
    expect(
      mensagensDeLog(log).some((m) => m.includes("turno pulado")),
      "o turno da conversa engajada não pode ser calado pelo filtro",
    ).toBe(false);
  });

  it("CONTROLE DA ENTRADA: sem engajamento, a MESMA mensagem continua calando", async () => {
    const log = logFalso();
    const pool = poolCom(
      [texto("outbound", "Oi! Como posso ajudar?", 0), texto("inbound", "camiseta azul, tamanho M", 3)],
      texto("inbound", "camiseta azul, tamanho M", 3),
    );
    await expect(turno(pool, FILTRO, log, false)).resolves.toBeUndefined();
    expect(mensagensDeLog(log).some((m) => m.includes("turno pulado"))).toBe(true);
  });

  it("CONTROLE: engajado e SEM filtro configurado segue idêntico", async () => {
    const pool = poolCom(
      [texto("outbound", "Oi!", 0), texto("inbound", "camiseta azul, tamanho M", 3)],
      texto("inbound", "camiseta azul, tamanho M", 3),
    );
    await expect(turno(pool, null, logFalso(), true)).rejects.toThrow(/config LLM/);
  });

  it("CONTROLE: engajado NÃO vence o pedido de humano (a ordem do início do turno fica)", async () => {
    const log = logFalso();
    const pool = poolCom(
      [texto("outbound", "Oi!", 0), texto("inbound", "quero falar com um atendente", 3)],
      texto("inbound", "quero falar com um atendente", 3),
    );
    await expect(turno(pool, FILTRO, log, true)).resolves.toBeUndefined();
    expect(mocks.passagem).toHaveBeenCalledTimes(1);
    expect(mocks.passagem.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ reason: "requested_human" }),
    );
  });

  it("CONTROLE: engajado NÃO vence o opt-out ambíguo", async () => {
    const pool = poolCom(
      [texto("outbound", "Oi!", 0), texto("inbound", "me deixa em paz", 3)],
      texto("inbound", "me deixa em paz", 3),
    );
    await expect(turno(pool, FILTRO, logFalso(), true)).resolves.toBeUndefined();
    expect(mocks.passagem.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ reason: "suspected_optout" }),
    );
  });

  it("CONTROLE: falha aberta segue aberta — regex quebrada não vira mordaça", async () => {
    // O filtro que a tela grava torto NÃO é filtro: `lerFiltroDePalavraChave`
    // devolve null (falha aberta), e o turno segue, engajado ou não.
    const quebrado = lerFiltroDePalavraChave({ filters: { keyword_regex: "(orçamento" } });
    expect(quebrado).toBeNull();
    const pool = poolCom(
      [texto("outbound", "Oi!", 0), texto("inbound", "camiseta azul, tamanho M", 3)],
      texto("inbound", "camiseta azul, tamanho M", 3),
    );
    await expect(turno(pool, quebrado, logFalso(), false)).rejects.toThrow(/config LLM/);
  });
});

/**
 * A ORDEM também se vigia no texto — comportamento verde por acidente (ex.: o
 * portão virar no-op) não prova posição, e o defeito do CR é de posição.
 */
describe("fiação — o portão vem DEPOIS das duas detecções", () => {
  const FONTE = readFileSync(
    join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
    "utf8",
  );

  it("executarTurnoDoAgente: detecções, depois o filtro, depois a janela", () => {
    const i = FONTE.indexOf("async function executarTurnoDoAgente(");
    expect(i, "executarTurnoDoAgente sumiu do fonte").toBeGreaterThan(-1);
    const t = FONTE.slice(i);
    const handoff = t.indexOf("detectHumanHandoffRequest(texto)");
    const optOut = t.indexOf("detectAmbiguousOptOut(texto)");
    const filtro = t.indexOf("turnoDisparaNasMensagens(");
    const janela = t.indexOf("msAteAJanelaAbrir(agentConfig.janelaDeAtendimento");
    expect(handoff, "a detecção de pedido de humano não está no turno").toBeGreaterThan(-1);
    expect(optOut, "a detecção de opt-out não está no turno").toBeGreaterThan(-1);
    expect(filtro, "o portão do filtro sumiu do turno").toBeGreaterThan(-1);
    expect(filtro, "o portão voltou para cima do handoff").toBeGreaterThan(handoff);
    expect(filtro, "o portão voltou para cima do opt-out").toBeGreaterThan(optOut);
    // E o filtro antes da janela: miss não pode receber aviso de fora do horário.
    expect(janela).toBeGreaterThan(filtro);
  });

  it("o portão julga `inboundsPendentes` (a rajada), não só a mensagem fixada", () => {
    const i = FONTE.indexOf("async function executarTurnoDoAgente(");
    const t = FONTE.slice(i);
    expect(t).toMatch(
      /inboundsPendentes\.length > 0\s*\?\s*inboundsPendentes\s*:\s*mensagemDoJob/,
    );
  });

  /**
   * #3142 — o portão passou a olhar o ENGAJAMENTO antes de julgar a mensagem. Se
   * essa leitura sumir, o defeito do #2696 volta (conversa engajada calada por
   * um miss) e nenhum teste de decisão pura denuncia: é a ligação que se vigia.
   */
  it("o portão lê o engajamento da resolução (o sticky) e não de uma segunda fonte", () => {
    const i = FONTE.indexOf("async function executarTurnoDoAgente(");
    const t = FONTE.slice(i);
    const leitura = t.indexOf("'agenteJaEngajado' in routed");
    expect(leitura, "a leitura do engajamento sumiu do turno").toBeGreaterThan(-1);
    expect(t, "o portão parou de consultar o engajamento").toMatch(/!agenteJaEngajado/);
    // A leitura vem ANTES do portão, no mesmo ponto que as outras leituras da
    // resolução (#2155), e o portão segue depois das duas detecções (acima).
    expect(leitura).toBeLessThan(t.indexOf("turnoDisparaNasMensagens("));
  });
});
