import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  argumentos,
  bancoFalso,
  filtros,
  operacao,
  valorDoFiltro,
  type BancoFalso,
  type Cadeia,
  type Resposta,
} from "@/tests/helpers/banco-falso-da-cobranca";

/**
 * #3357 — O PRIMEIRO ENVIO DE UM `external_id` INÉDITO ADOTA O CARD ABERTO DO
 * CONTATO (e carimba o id nele).
 *
 * ## O defeito medido, na voz de quem o abriu
 *
 * Com a opção "Reaproveitar o card aberto do contato" ligada, o reuso existia só
 * no ramo SEM `external_id` (o portão `if (!externalId)`). O caso de quem
 * integra de verdade — o da #3101, que usa `external_id` para o 2º evento
 * atualizar o 1º (#2316) — ficava de fora:
 *
 *   1. a pessoa chega pelo WhatsApp e a IA abre o card dela no funil "Vendas";
 *   2. ela cria conta no sistema de fora; o webhook manda `external_id = <id da
 *      conta>` e o evento `trial_iniciado`. `findLeadByExternalId` não acha nada
 *      (é o 1º envio desse id) e a captação CRIA um 2º card no mesmo funil,
 *      mesmo com o contato casado e o card da conversa ABERTO;
 *   3. o evento seguinte (`trial_ativado`, mesmo id) atualiza o 2º card — o do
 *      WhatsApp fica parado. Um contato, dois cards abertos.
 *
 * ## O que este arquivo fixa
 *
 * 1. ⭐ com a opção LIGADA, o primeiro envio com id inédito ATUALIZA o card
 *    aberto do contato no funil da fonte e CARIMBA nele o `external_id` e o
 *    `webhook_source_id` — nenhum segundo card é criado;
 * 2. ⭐ o SEGUNDO envio do mesmo id casa por id (o fast-path do #2316): o
 *    carimbo não se repete e o card adotado é que é atualizado;
 * 3. as regressões: id JÁ existente continua mandando (nem se procura card
 *    aberto), a opção (ou a coluna) desligada cria o card como hoje, e contato
 *    sem card aberto no funil da fonte cria o card como hoje;
 * 4. o carimbo é um compare-and-set: o card que JÁ responde por outro id não tem
 *    a identidade trocada — o retry do outro id abriria um terceiro card.
 *
 * O duplê é o `bancoFalso` das rotas vizinhas: ele grava cada cadeia do
 * PostgREST (tabela, método, argumentos), e é o que deixa o teste afirmar O QUE
 * a rota mandou ao banco — o payload do carimbo e os filtros dele —, e não só o
 * status HTTP.
 */

const h = vi.hoisted(() => ({
  registrar: vi.fn(async () => undefined),
  criarLead: vi.fn(async (..._args: unknown[]) => ({ id: "lead-novo" })),
  atualizarLead: vi.fn(async (..._args: unknown[]) => ({ id: "lead-whatsapp" })),
  moverLead: vi.fn(async (..._args: unknown[]) => ({ id: "lead-whatsapp" })),
  banco: undefined as unknown as BancoFalso,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.banco.cliente }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/webhooks/captacao", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  registrarCaptacao: h.registrar,
}));
vi.mock("@/app/api/v1/leads/_handler", () => ({
  createLeadHandler: h.criarLead,
  updateLeadHandler: h.atualizarLead,
  moveLeadHandler: h.moverLead,
}));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({ kickLocalPipeline: async () => undefined }));

import { POST } from "./route";

const ORG = "org-1";
const TOKEN = "token-da-fonte-0001";
const CARD_DA_CONVERSA = "lead-whatsapp";

/** A fonte com o reuso LIGADO — o estado de quem abre a issue. */
const FONTE = {
  id: "fonte-1",
  name: "Integração do produto",
  organization_id: ORG,
  // Sem segredo: a fonte entra pela rota pública (a assinatura é exigida no
  // PATCH da fonte, não na captação).
  secret_encrypted: null,
  default_pipeline_id: "pipe-1",
  default_stage_id: "stage-1",
  field_map: {},
  form_fields: [],
  redirect_to: null,
  is_active: true,
  authorize_ai_on_capture: false,
  /**
   * A opção IRMÃ (#2316) fica desligada na maioria dos casos de propósito: o
   * reenvio não pode ser confundido com a adoção que este arquivo mede.
   */
  update_existing_lead_on_capture: false,
  reuse_open_lead_on_capture: true,
};

const ETAPAS = [
  { id: "stage-1", name: "Em conversa", position: 1 },
  { id: "stage-2", name: "Teste iniciado", position: 2 },
];

/** O card que a CONVERSA abriu, na etapa de entrada do funil da fonte. */
const CARD_ABERTO = {
  id: CARD_DA_CONVERSA,
  contact_id: "contato-1",
  title: "Joana",
  custom_fields: { evento: "conversa_iniciada" },
  pipeline_id: "pipe-1",
  stage_id: "stage-1",
};

const CONTATO = { id: "contato-1", phone_number: "+5532984793302", name: "Joana" };

interface Mundo {
  fonte: Record<string, unknown>;
  /** O que `findLeadByExternalId` acha: `null` = o id é inédito. */
  porExternalId: Record<string, unknown> | null;
  /** O card aberto do contato no funil da fonte. */
  cardAberto: Record<string, unknown> | null;
  contato: Record<string, unknown> | null;
}

let m: Mundo;

function responder(c: Cadeia): Resposta {
  if (c.tabela === "webhook_sources") return { data: m.fonte };
  if (c.tabela === "contacts") {
    // Duas leituras de `contacts` no caminho: a busca por grafias do telefone
    // (uma LISTA, que `escolherContatoCanonico` desempata) e o portão de titular
    // anonimizado do reenvio (uma linha).
    const colunas = String(argumentos(c, "select")?.[0] ?? "");
    if (colunas.includes("is_anonymized")) return { data: { is_anonymized: false } };
    return { data: m.contato ? [m.contato] : [] };
  }
  if (c.tabela === "crm_stages") return { data: ETAPAS };
  if (c.tabela === "crm_leads") {
    if (operacao(c) === "update") return { data: null };
    if (operacao(c) === "insert") return { data: { id: "lead-novo" } };
    // A leitura por id (fast-path do #2316) é a única que filtra `external_id`.
    if (valorDoFiltro(c, "eq", "external_id") !== undefined) return { data: m.porExternalId };
    return { data: m.cardAberto };
  }
  return { data: null };
}

async function enviar(corpo: Record<string, unknown>): Promise<Response> {
  const req = new NextRequest(`http://localhost/api/v1/webhooks/in/${TOKEN}`, {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
  return (await POST(req, { params: Promise.resolve({ token: TOKEN }) })) as Response;
}

/** As leituras do card aberto do contato — a pergunta do #3101. */
const leiturasDoCardAberto = () =>
  h.banco.cadeias.filter(
    (c) =>
      c.tabela === "crm_leads" &&
      operacao(c) === "select" &&
      valorDoFiltro(c, "eq", "status") === "open",
  );

/** Os UPDATE que carimbam o id do envio no card (a coluna só existe neles). */
const carimbos = () =>
  h.banco.cadeias.filter((c) => {
    if (c.tabela !== "crm_leads" || operacao(c) !== "update") return false;
    const payload = argumentos(c, "update")?.[0] as Record<string, unknown> | undefined;
    return !!payload && "external_id" in payload;
  });

function desfecho(): string | undefined {
  const chamadas = h.registrar.mock.calls as unknown as Array<[unknown, { outcome?: string }]>;
  return chamadas.at(-1)?.[1]?.outcome;
}

/** O envio de quem cria conta no sistema de fora: id inédito e evento novo. */
const ENVIO_DO_TRIAL = {
  external_id: "conta-3357",
  nome: "Joana",
  telefone: "+5532984793302",
  evento: "trial_iniciado",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.criarLead.mockResolvedValue({ id: "lead-novo" });
  h.atualizarLead.mockResolvedValue({ id: CARD_DA_CONVERSA });
  h.moverLead.mockResolvedValue({ id: CARD_DA_CONVERSA });
  m = {
    fonte: { ...FONTE },
    porExternalId: null,
    cardAberto: { ...CARD_ABERTO },
    contato: { ...CONTATO },
  };
  h.banco = bancoFalso(responder, () => ({}));
});

describe("primeiro envio com external_id inédito adota o card aberto (#3357)", () => {
  it("⭐ adota o card da conversa e carimba nele o external_id e a fonte — nenhum segundo card", async () => {
    const res = await enviar(ENVIO_DO_TRIAL);

    expect(
      h.criarLead,
      "com a opção ligada o contato ficou com DOIS cards abertos no mesmo funil — o defeito da issue",
    ).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { lead_id: CARD_DA_CONVERSA } });

    // O id do envio passa a apontar para o card que a equipe já está tocando.
    const feitos = carimbos();
    expect(feitos).toHaveLength(1);
    expect(argumentos(feitos[0]!, "update")?.[0]).toEqual({
      external_id: "conta-3357",
      webhook_source_id: "fonte-1",
    });
    expect(filtros(feitos[0]!)).toEqual([
      ["eq", "organization_id", ORG],
      ["eq", "id", CARD_DA_CONVERSA],
      ["is", "external_id", null],
    ]);

    // O evento novo entra NELE — não num card novo.
    expect(h.atualizarLead.mock.calls[0]?.[2]).toBe(CARD_DA_CONVERSA);
    expect(h.atualizarLead.mock.calls[0]?.[3]).toEqual({
      custom_fields: { evento: "trial_iniciado" },
    });
    expect(desfecho()).toBe("atualizado");
  });

  it("⭐ o SEGUNDO envio do mesmo id casa por id: atualiza o card adotado e não carimba de novo", async () => {
    // O card que o primeiro envio adotou e carimbou é o que o fast-path acha.
    m.porExternalId = { ...CARD_ABERTO, webhook_source_id: "fonte-1" };
    m.fonte = { ...FONTE, update_existing_lead_on_capture: true };

    const res = await enviar({ ...ENVIO_DO_TRIAL, evento: "trial_ativado" });

    expect(h.criarLead).not.toHaveBeenCalled();
    expect(carimbos()).toHaveLength(0);
    expect(
      leiturasDoCardAberto(),
      "o envio de um id já existente foi procurar card aberto: o id é quem manda",
    ).toHaveLength(0);
    expect(h.atualizarLead.mock.calls[0]?.[2]).toBe(CARD_DA_CONVERSA);
    expect(h.atualizarLead.mock.calls[0]?.[3]).toEqual({
      custom_fields: { evento: "trial_ativado" },
    });
    expect(desfecho()).toBe("atualizado");
    expect(res.status).toBe(200);
  });
});

describe("regressões do caminho com external_id (#3357)", () => {
  it("⭐ id JÁ existente continua mandando: atualiza o card DO ID, e o card aberto do contato não é tocado", async () => {
    m.fonte = { ...FONTE, update_existing_lead_on_capture: true };
    m.porExternalId = {
      ...CARD_ABERTO,
      id: "lead-do-id",
      webhook_source_id: "fonte-1",
    };
    // O contato TEM outro card aberto no funil — e ele não pode virar o alvo.
    m.cardAberto = { ...CARD_ABERTO, id: "lead-outro-card" };

    const res = await enviar(ENVIO_DO_TRIAL);

    expect(h.criarLead).not.toHaveBeenCalled();
    expect(leiturasDoCardAberto()).toHaveLength(0);
    expect(carimbos()).toHaveLength(0);
    expect(h.atualizarLead.mock.calls[0]?.[2]).toBe("lead-do-id");
    expect(desfecho()).toBe("atualizado");
    expect(res.status).toBe(200);
  });

  it("⭐ opção DESLIGADA: o primeiro envio com id inédito cria o card como hoje", async () => {
    m.fonte = { ...FONTE, reuse_open_lead_on_capture: false };

    const res = await enviar(ENVIO_DO_TRIAL);

    expect(leiturasDoCardAberto()).toHaveLength(0);
    expect(carimbos()).toHaveLength(0);
    expect(h.criarLead).toHaveBeenCalledTimes(1);
    const leadInput = h.criarLead.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(leadInput.external_id).toBe("conta-3357");
    expect(leadInput.contact_id).toBe("contato-1");
    expect(leadInput.pipeline_id).toBe("pipe-1");
    expect(leadInput.stage_id).toBe("stage-1");
    expect(desfecho()).toBe("criado");
    expect(await res.json()).toEqual({ data: { lead_id: "lead-novo" } });
  });

  it("⭐ coluna AUSENTE (instalação sem a migration): também cria o card como hoje", async () => {
    const semColuna = { ...FONTE } as Record<string, unknown>;
    delete semColuna.reuse_open_lead_on_capture;
    m.fonte = semColuna;

    await enviar(ENVIO_DO_TRIAL);

    expect(leiturasDoCardAberto()).toHaveLength(0);
    expect(carimbos()).toHaveLength(0);
    expect(h.criarLead).toHaveBeenCalledTimes(1);
    expect(desfecho()).toBe("criado");
  });

  it("⭐ contato sem card aberto no funil da fonte: cria o card como hoje", async () => {
    m.cardAberto = null;

    const res = await enviar(ENVIO_DO_TRIAL);

    expect(leiturasDoCardAberto()).toHaveLength(1);
    expect(carimbos()).toHaveLength(0);
    expect(h.criarLead).toHaveBeenCalledTimes(1);
    expect(desfecho()).toBe("criado");
    expect(res.status).toBe(200);
  });

  it("o carimbo é compare-and-set: o card que já responde por outro id não tem a identidade trocada", async () => {
    await enviar(ENVIO_DO_TRIAL);

    const feitos = carimbos();
    expect(feitos).toHaveLength(1);
    expect(
      filtros(feitos[0]!),
      "o carimbo sobrescreveu o id de outro envio: o retry DAQUELE id abriria um terceiro card",
    ).toContainEqual(["is", "external_id", null]);
  });
});
