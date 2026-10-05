import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import objetos from "@/tests/fixtures/stripe/objetos.json";

import { ErroDoProvedor } from "./contrato";
import {
  criarAdaptadorStripe,
  emFormulario,
  erroDaStripe,
  marcaDaInstalacao,
  modoDaChaveStripe,
  STRIPE_API_BASE,
  STRIPE_VERSION,
  verificarWebhookStripe,
  type DependenciasDaStripe,
} from "./stripe";

/**
 * O ADAPTADOR DA STRIPE (spec da cobrança do revendedor §6.1), contra uma
 * Stripe de mentira que responde com a forma real da API. Nenhuma chamada
 * real: o teste contra a conta de teste é scripts/smoke-stripe.ts, fora do CI.
 */

// Chaves de mentira no formato real, MONTADAS em tempo de execução: um
// literal `sk_live_…` ou `sk_test_…` no repositório dispara a varredura de
// segredo do GitHub no push (o de teste também: medido em 05/10).
const CHAVE_TESTE = ["sk", "test", "51HfakeKeyForUnitTests00"].join("_");
const CHAVE_REAL = ["sk", "live", "51HfakeKeyForUnitTests00"].join("_");
const RESTRITA_REAL = ["rk", "live", "51HfakeKeyForUnitTests00"].join("_");
/** A marca desta instalação na conta (metadata `cobranca_do_revendedor`). */
const MARCA = "a1b2c3d4e5f60718";

type Resposta = { status?: number; corpo?: unknown; headers?: Record<string, string> } | "rede_caiu";
type Responder = Resposta | Resposta[] | ((url: URL) => Resposta);
type Chamada = { rota: string; url: URL; headers: Headers; corpo: URLSearchParams };

/**
 * Cada rota é "MÉTODO /caminho" (sem `/v1` e sem query). Lista = fila; a última
 * resposta se repete. Rota não declarada → 404 com o nome dela no `code`, para
 * o erro dizer qual chamada o teste não previu.
 */
function stripeFalsa(rotas: Record<string, Responder>) {
  const filas = new Map<string, Responder>(
    Object.entries(rotas).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]),
  );
  const chamadas: Chamada[] = [];
  const fetchFalso: typeof fetch = async (entrada, init) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    const rota = `${init?.method ?? "GET"} ${url.pathname.replace(/^\/v1/, "")}`;
    chamadas.push({
      rota,
      url,
      headers: new Headers(init?.headers),
      corpo: new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
    });
    const r = filas.get(rota);
    const resposta = typeof r === "function" ? r(url) : Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r;
    if (resposta === undefined) {
      return Response.json({ error: { code: `rota_nao_declarada:${rota}` } }, { status: 404 });
    }
    if (resposta === "rede_caiu") throw new TypeError("fetch failed");
    return Response.json(resposta.corpo ?? {}, { status: resposta.status ?? 200, headers: resposta.headers });
  };
  return { fetchFalso, chamadas };
}

function montar(rotas: Record<string, Responder>, extra: Partial<DependenciasDaStripe> = {}) {
  const { fetchFalso, chamadas } = stripeFalsa(rotas);
  const esperas: number[] = [];
  const adaptador = criarAdaptadorStripe({
    lerChave: async () => CHAVE_TESTE,
    fetch: fetchFalso,
    esperar: async (ms) => {
      esperas.push(ms);
    },
    agora: () => new Date("2026-10-01T12:00:00Z"),
    novaChaveDeIdempotencia: () => "idem-fixa",
    marca: MARCA,
    ...extra,
  });
  return { adaptador, chamadas, esperas };
}

const LISTA_VAZIA = { corpo: { object: "list", data: [], has_more: false } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o transporte da Stripe", () => {
  it("⭐ a chave vai só no Authorization, a versão é fixada e a URL não carrega segredo", async () => {
    const { adaptador, chamadas } = montar({ "GET /customers": LISTA_VAZIA });
    await adaptador.testarChave();
    const [c] = chamadas;
    expect(c?.headers.get("authorization")).toBe(`Bearer ${CHAVE_TESTE}`);
    expect(c?.headers.get("stripe-version")).toBe(STRIPE_VERSION);
    expect(`${c?.url.origin}${c?.url.pathname}`).toBe(`${STRIPE_API_BASE}/customers`);
    expect(c?.url.search).not.toMatch(/sk_|rk_/);
  });

  it("emFormulario achata objeto e lista no formato da Stripe e pula nulo", () => {
    const corpo = emFormulario({
      line_items: [{ price_data: { currency: "brl", recurring: { interval: "month" } }, quantity: 1 }],
      enabled_events: ["invoice.paid", "invoice.payment_failed"],
      cancel_at_period_end: true,
      vazio: null,
      ausente: undefined,
    });
    expect([...new URLSearchParams(corpo)]).toEqual([
      ["line_items[0][price_data][currency]", "brl"],
      ["line_items[0][price_data][recurring][interval]", "month"],
      ["line_items[0][quantity]", "1"],
      ["enabled_events[0]", "invoice.paid"],
      ["enabled_events[1]", "invoice.payment_failed"],
      ["cancel_at_period_end", "true"],
    ]);
  });

  it.each([
    [401, { error: { type: "invalid_request_error" } }, { status: 401, codigo: "chave_invalida", transitorio: false, credencialInvalida: true }],
    [403, { error: { type: "invalid_request_error" } }, { status: 403, codigo: "sem_permissao", transitorio: false, credencialInvalida: true }],
    [404, { error: { code: "resource_missing", type: "invalid_request_error" } }, { status: 404, codigo: "resource_missing", transitorio: false, credencialInvalida: false }],
    [400, { error: { type: "idempotency_error" } }, { status: 400, codigo: "idempotency_error", transitorio: false, credencialInvalida: false }],
    [409, { error: { code: "lock_timeout" } }, { status: 409, codigo: "lock_timeout", transitorio: true, credencialInvalida: false }],
    [409, { error: { code: "idempotency_key_in_use" } }, { status: 409, codigo: "idempotency_key_in_use", transitorio: true, credencialInvalida: false }],
    [429, { error: { code: "rate_limit" } }, { status: 429, codigo: "rate_limit", transitorio: true, credencialInvalida: false }],
    [503, null, { status: 503, codigo: "provedor_fora", transitorio: true, credencialInvalida: false }],
  ])("HTTP %i vira o ErroDoProvedor certo", (status, corpo, esperado) => {
    const erro = erroDaStripe(status, corpo);
    expect(erro).toBeInstanceOf(ErroDoProvedor);
    expect(erro).toMatchObject(esperado);
  });

  it("⭐ o erro nunca carrega o texto da Stripe — ele ecoa pedaço da chave", () => {
    const erro = erroDaStripe(401, {
      error: { type: "invalid_request_error", message: "Invalid API Key provided: sk_test_****abcd" },
    });
    expect(erro.message).toBe("provedor 401 chave_invalida");
    expect(JSON.stringify({ ...erro, m: erro.message })).not.toContain("sk_test");
  });

  it("429, 429, 200: três tentativas, respeitando o Retry-After", async () => {
    const { adaptador, chamadas, esperas } = montar({
      "GET /customers": [
        { status: 429, headers: { "retry-after": "1" }, corpo: { error: { code: "rate_limit" } } },
        { status: 429, corpo: { error: { code: "rate_limit" } } },
        LISTA_VAZIA,
      ],
    });
    expect(await adaptador.testarChave()).toEqual({ ok: true, modo: "teste" });
    expect(chamadas).toHaveLength(3);
    expect(esperas).toEqual([1000, 1000]);
  });

  it("5xx persistente: desiste na 3ª (retry LIMITADO) e diz provedor_fora", async () => {
    const { adaptador, chamadas, esperas } = montar({ "GET /customers": { status: 503, corpo: null } });
    expect(await adaptador.testarChave()).toEqual({ ok: false, motivo: "provedor_fora" });
    expect(chamadas).toHaveLength(3);
    expect(esperas).toEqual([500, 1000]);
  });

  it("Stripe-Should-Retry: false manda parar na 1ª, e true manda repetir um 400", async () => {
    const parar = montar({ "GET /customers": { status: 500, headers: { "stripe-should-retry": "false" } } });
    await parar.adaptador.testarChave();
    expect(parar.chamadas).toHaveLength(1);
    const repetir = montar({
      "GET /customers": [{ status: 400, headers: { "stripe-should-retry": "true" }, corpo: { error: { type: "api_error" } } }, LISTA_VAZIA],
    });
    expect(await repetir.adaptador.testarChave()).toEqual({ ok: true, modo: "teste" });
    expect(repetir.chamadas).toHaveLength(2);
  });

  it("rede caiu uma vez e voltou: segue; Retry-After enorme é limitado a 5 s", async () => {
    const rede = montar({ "GET /customers": ["rede_caiu", LISTA_VAZIA] });
    expect(await rede.adaptador.testarChave()).toEqual({ ok: true, modo: "teste" });
    const longo = montar({ "GET /customers": [{ status: 429, headers: { "retry-after": "30" } }, LISTA_VAZIA] });
    await longo.adaptador.testarChave();
    expect(longo.esperas).toEqual([5000]);
  });

  it("400 comum não repete", async () => {
    const { adaptador, chamadas } = montar({ "GET /customers": { status: 400, corpo: { error: { code: "parameter_invalid_integer" } } } });
    await adaptador.testarChave();
    expect(chamadas).toHaveLength(1);
  });

  it("o log da nova tentativa não leva a chave", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { adaptador } = montar({ "GET /customers": [{ status: 503 }, LISTA_VAZIA] });
    await adaptador.testarChave();
    const escrito = aviso.mock.calls.flat().join(" ");
    expect(escrito).toContain("cobranca.stripe.nova_tentativa");
    expect(escrito).not.toContain(CHAVE_TESTE);
  });

  it("base fora da lista (nem a oficial, nem loopback) lança na construção", () => {
    expect(() =>
      criarAdaptadorStripe({ lerChave: async () => CHAVE_TESTE, baseUrl: "https://coletor.example.com/v1", marca: MARCA }),
    ).toThrow(/recusada/);
  });

  it("⭐ a marca é por instalação: mesma origem, mesma marca; outro domínio, outra marca", () => {
    const producao = marcaDaInstalacao("https://crm.loja.com.br");
    expect(producao).toMatch(/^[0-9a-f]{16}$/);
    expect(marcaDaInstalacao("https://CRM.loja.com.br/")).toBe(producao);
    expect(marcaDaInstalacao("https://homolog.loja.com.br")).not.toBe(producao);
  });
});

describe("testarChave", () => {
  it.each([
    [CHAVE_TESTE, "teste"],
    [["rk", "test", "51HfakeKeyForUnitTests00"].join("_"), "teste"],
    [CHAVE_REAL, "producao"],
    [RESTRITA_REAL, "producao"],
    ["pk_test_51HfakeKeyForUnitTests00", null],
    ["whsec_51HfakeKeyForUnitTests00", null],
    ["sk_test_curta", null],
    ["", null],
  ])("modoDaChaveStripe(%s) = %s", (chave, modo) => {
    expect(modoDaChaveStripe(chave)).toBe(modo);
  });

  it("chave de teste e restrita de produção: ok com o modo do prefixo", async () => {
    expect(await montar({ "GET /customers": LISTA_VAZIA }).adaptador.testarChave()).toEqual({ ok: true, modo: "teste" });
    const real = montar({ "GET /customers": LISTA_VAZIA }, { lerChave: async () => RESTRITA_REAL });
    expect(await real.adaptador.testarChave()).toEqual({ ok: true, modo: "producao" });
  });

  it("chave publicável ou ausente: chave_invalida SEM chamar a Stripe", async () => {
    const pk = montar({}, { lerChave: async () => "pk_test_51HfakeKeyForUnitTests00" });
    expect(await pk.adaptador.testarChave()).toEqual({ ok: false, motivo: "chave_invalida" });
    const nula = montar({}, { lerChave: async () => null });
    expect(await nula.adaptador.testarChave()).toEqual({ ok: false, motivo: "chave_invalida" });
    expect([...pk.chamadas, ...nula.chamadas]).toHaveLength(0);
  });

  it("401 → chave_invalida; 403 (restrita sem permissão) → sem_permissao", async () => {
    expect(await montar({ "GET /customers": { status: 401 } }).adaptador.testarChave()).toEqual({ ok: false, motivo: "chave_invalida" });
    expect(await montar({ "GET /customers": { status: 403 } }).adaptador.testarChave()).toEqual({ ok: false, motivo: "sem_permissao" });
  });

  it("⭐ instalação em teste recusa chave REAL antes de enviá-la", async () => {
    const { adaptador, chamadas } = montar({ "GET /customers": LISTA_VAZIA }, { lerChave: async () => CHAVE_REAL });
    expect(await adaptador.testarChave({ modoExigido: "teste" })).toEqual({ ok: false, motivo: "modo_divergente", modo: "producao" });
    expect(chamadas).toHaveLength(0);
  });

  it("e o inverso: produção exigida recusa chave de teste", async () => {
    const { adaptador, chamadas } = montar({ "GET /customers": LISTA_VAZIA });
    expect(await adaptador.testarChave({ modoExigido: "producao" })).toEqual({ ok: false, motivo: "modo_divergente", modo: "teste" });
    expect(chamadas).toHaveLength(0);
  });

  it("⭐ com o stub em loopback, chave real nunca sai da máquina", async () => {
    const { adaptador, chamadas } = montar(
      { "GET /customers": LISTA_VAZIA },
      { lerChave: async () => CHAVE_REAL, baseUrl: "http://127.0.0.1:4010/v1" },
    );
    expect(await adaptador.testarChave()).toEqual({ ok: false, motivo: "modo_divergente", modo: "producao" });
    expect(chamadas).toHaveLength(0);
  });
});

describe("verificarWebhook", () => {
  // Montados em tempo de execução: literal whsec_ longo dispara a varredura de segredo no push.
  const SEGREDO = ["whsec", "fixtureSegredoNovo0000000000"].join("_");
  const SEGREDO_VELHO = ["whsec", "fixtureSegredoVelho000000000"].join("_");
  const AGORA = new Date("2026-10-01T12:00:00Z");
  const T = Math.floor(AGORA.getTime() / 1000);
  const CORPO = JSON.stringify(objetos.evento);
  const hmac = (segredo: string, t: number, corpo = CORPO) =>
    createHmac("sha256", segredo).update(`${t}.${corpo}`, "utf8").digest("hex");
  const cab = (valor: string) => new Headers({ "stripe-signature": valor });
  const SINAL = { eventoId: "evt_1QfixtureInvoicePaid", tipo: "invoice.paid", clienteRef: "cus_QfixtureCliente" };

  it("evento assinado vira sinal, só ponteiros, nada do corpo", () => {
    expect(verificarWebhookStripe(CORPO, cab(`t=${T},v1=${hmac(SEGREDO, T)}`), SEGREDO, AGORA)).toEqual(SINAL);
  });

  it("rotação: o segundo v1 é conferido; só o velho não passa com o segredo novo", () => {
    const duplo = `t=${T},v1=${hmac(SEGREDO_VELHO, T)},v1=${hmac(SEGREDO, T)}`;
    expect(verificarWebhookStripe(CORPO, cab(duplo), SEGREDO, AGORA)).toEqual(SINAL);
    expect(verificarWebhookStripe(CORPO, cab(`t=${T},v1=${hmac(SEGREDO_VELHO, T)}`), SEGREDO, AGORA)).toBeNull();
  });

  it("v0 (esquema de teste) é ignorado, mesmo com HMAC certo", () => {
    expect(verificarWebhookStripe(CORPO, cab(`t=${T},v0=${hmac(SEGREDO, T)}`), SEGREDO, AGORA)).toBeNull();
  });

  it("relógio: 301 s no passado ou no futuro recusa; 299 s no futuro (nosso relógio atrasado) passa", () => {
    expect(verificarWebhookStripe(CORPO, cab(`t=${T - 301},v1=${hmac(SEGREDO, T - 301)}`), SEGREDO, AGORA)).toBeNull();
    expect(verificarWebhookStripe(CORPO, cab(`t=${T + 301},v1=${hmac(SEGREDO, T + 301)}`), SEGREDO, AGORA)).toBeNull();
    expect(verificarWebhookStripe(CORPO, cab(`t=${T + 299},v1=${hmac(SEGREDO, T + 299)}`), SEGREDO, AGORA)).toEqual(SINAL);
  });

  it("corpo alterado em um byte recusa", () => {
    expect(verificarWebhookStripe(`${CORPO} `, cab(`t=${T},v1=${hmac(SEGREDO, T)}`), SEGREDO, AGORA)).toBeNull();
  });

  it.each([
    ["sem header", new Headers()],
    ["header lixo", cab("lixo")],
    ["v1 curto", cab(`t=${T},v1=abc`)],
    ["t não numérico", cab(`t=ontem,v1=${hmac(SEGREDO, T)}`)],
  ])("%s → null, sem lançar", (_nome, headers) => {
    expect(verificarWebhookStripe(CORPO, headers, SEGREDO, AGORA)).toBeNull();
  });

  it("segredo vazio nunca valida", () => {
    expect(verificarWebhookStripe(CORPO, cab(`t=${T},v1=${hmac("", T)}`), "", AGORA)).toBeNull();
  });

  it("evento repetido devolve o MESMO eventoId — quem deduplica é o (provider, external_id) da rota", () => {
    const h = cab(`t=${T},v1=${hmac(SEGREDO, T)}`);
    expect(verificarWebhookStripe(CORPO, h, SEGREDO, AGORA)?.eventoId).toBe(verificarWebhookStripe(CORPO, h, SEGREDO, AGORA)?.eventoId);
  });

  it("assinado mas não é evento (sem evt_) → null", () => {
    const corpo = JSON.stringify({ id: "in_1", type: "invoice.paid", data: { object: {} } });
    expect(verificarWebhookStripe(corpo, cab(`t=${T},v1=${hmac(SEGREDO, T, corpo)}`), SEGREDO, AGORA)).toBeNull();
  });

  it("customer expandido dá o id; customer nulo dá clienteRef null", () => {
    const expandido = JSON.stringify({ ...objetos.evento, data: { object: { customer: { id: "cus_X" } } } });
    const nulo = JSON.stringify({ ...objetos.evento, data: { object: { customer: null } } });
    expect(verificarWebhookStripe(expandido, cab(`t=${T},v1=${hmac(SEGREDO, T, expandido)}`), SEGREDO, AGORA)?.clienteRef).toBe("cus_X");
    expect(verificarWebhookStripe(nulo, cab(`t=${T},v1=${hmac(SEGREDO, T, nulo)}`), SEGREDO, AGORA)?.clienteRef).toBeNull();
  });

  it("a comparação é em tempo constante (timingSafeEqual), nunca === entre strings", () => {
    const fonte = readFileSync(join(__dirname, "stripe.ts"), "utf8");
    expect(fonte).toContain("timingSafeEqual(");
    expect(fonte).not.toMatch(/===\s*esperada|esperada\s*===/);
  });

  it("o adaptador expõe a mesma função", () => {
    const { adaptador } = montar({});
    expect(adaptador.verificarWebhook(CORPO, cab(`t=${T},v1=${hmac(SEGREDO, T)}`), SEGREDO, AGORA)).toEqual(SINAL);
  });
});

describe("garantirCliente e iniciarAssinatura", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const PLANO = { id: "22222222-2222-4222-8222-222222222222", nome: "Pro", precoCents: 4990, intervalo: "mes" as const };
  const PRODUTO = `dc_plano_${PLANO.id}`;
  const SESSAO = { corpo: { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1", expires_at: 1790086400 } };
  const base = {
    clienteRef: "cus_QfixtureCliente",
    orgId: ORG,
    plano: PLANO,
    trialAte: null,
    urlDeVolta: "https://crm.example.com/app/settings/billing",
    chaveIdempotencia: "3f1c2d4e-0000-4000-8000-000000000001",
  };

  it("reusa o cliente que a busca por organization_id acha, sem criar outro", async () => {
    const { adaptador, chamadas } = montar({
      "GET /customers/search": { corpo: { object: "search_result", data: [{ id: "cus_existente" }] } },
    });
    expect(await adaptador.garantirCliente({ id: ORG, nome: "Loja", email: "a@example.com", documento: null })).toBe("cus_existente");
    expect(chamadas.map((c) => c.rota)).toEqual(["GET /customers/search"]);
    expect(chamadas[0]?.url.searchParams.get("query")).toBe(`metadata['organization_id']:'${ORG}'`);
  });

  it("⭐ sem cliente: cria com e-mail, nome e organization_id, com Idempotency-Key DA ORG (a busca demora ~1 min a enxergar o novo)", async () => {
    const criar = () =>
      montar({
        "GET /customers/search": { corpo: { object: "search_result", data: [] } },
        "POST /customers": { corpo: { id: "cus_novo" } },
      });
    const primeiro = criar();
    expect(await primeiro.adaptador.garantirCliente({ id: ORG, nome: "Loja", email: "a@example.com", documento: "12345678909" })).toBe("cus_novo");
    const post = primeiro.chamadas[1];
    expect(Object.fromEntries(post?.corpo ?? [])).toEqual({ email: "a@example.com", name: "Loja", "metadata[organization_id]": ORG });
    // Segundo clique dentro do atraso do índice de busca: a MESMA chave faz a Stripe devolver o mesmo cliente (24 h).
    const segundo = criar();
    await segundo.adaptador.garantirCliente({ id: ORG, nome: "Loja", email: "a@example.com", documento: null });
    expect(post?.headers.get("idempotency-key")).toBe(`cliente:${ORG}`);
    expect(segundo.chamadas[1]?.headers.get("idempotency-key")).toBe(`cliente:${ORG}`);
  });

  it("URL do Checkout que não é https → resposta_invalida (nunca vira redirect)", async () => {
    const { adaptador } = montar({
      "POST /products": { corpo: { id: PRODUTO } },
      "POST /checkout/sessions": { corpo: { id: "cs_x", url: "javascript:alert(1)", expires_at: 1790086400 } },
    });
    expect(await adaptador.iniciarAssinatura(base).catch((e: unknown) => e)).toMatchObject({ codigo: "resposta_invalida" });
  });

  it("id de org que não é uuid nunca entra na consulta", async () => {
    const { adaptador, chamadas } = montar({});
    await expect(adaptador.garantirCliente({ id: "x' OR '1", nome: "L", email: "a@example.com", documento: null })).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });

  it("⭐ o Checkout: assinatura, cliente reutilizado, metadados da org e do plano, formas de pagamento da conta", async () => {
    const { adaptador, chamadas } = montar({ "POST /products": { corpo: { id: PRODUTO } }, "POST /checkout/sessions": SESSAO });
    expect(await adaptador.iniciarAssinatura(base)).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      expiraEm: new Date(1790086400 * 1000),
      assinaturaRef: null,
    });
    const checkout = chamadas.find((c) => c.rota === "POST /checkout/sessions");
    expect(Object.fromEntries(checkout?.corpo ?? [])).toEqual({
      mode: "subscription",
      customer: "cus_QfixtureCliente",
      client_reference_id: ORG,
      "line_items[0][price_data][currency]": "brl",
      "line_items[0][price_data][unit_amount]": "4990",
      "line_items[0][price_data][recurring][interval]": "month",
      "line_items[0][price_data][product]": PRODUTO,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][organization_id]": ORG,
      "subscription_data[metadata][plano_id]": PLANO.id,
      "metadata[organization_id]": ORG,
      "metadata[plano_id]": PLANO.id,
      success_url: "https://crm.example.com/app/settings/billing?voltou=1",
      cancel_url: "https://crm.example.com/app/settings/billing",
      locale: "pt-BR",
    });
    // Sem payment_method_types: cartão e boleto aparecem conforme o painel da conta.
    expect(checkout?.headers.get("idempotency-key")).toBe(`${base.chaveIdempotencia}:checkout`);
  });

  it("teste grátis ≥ 48 h vai como trial_end; 47 h não vai (a Stripe recusaria)", async () => {
    const agora = new Date("2026-10-01T12:00:00Z").getTime();
    const com = montar({ "POST /products": { corpo: { id: PRODUTO } }, "POST /checkout/sessions": SESSAO });
    await com.adaptador.iniciarAssinatura({ ...base, trialAte: new Date(agora + 48 * 3600_000) });
    expect(com.chamadas[1]?.corpo.get("subscription_data[trial_end]")).toBe(String(Math.floor(agora / 1000) + 48 * 3600));
    const sem = montar({ "POST /products": { corpo: { id: PRODUTO } }, "POST /checkout/sessions": SESSAO });
    await sem.adaptador.iniciarAssinatura({ ...base, trialAte: new Date(agora + 47 * 3600_000) });
    expect(sem.chamadas[1]?.corpo.has("subscription_data[trial_end]")).toBe(false);
  });

  it("plano anual vira interval=year", async () => {
    const { adaptador, chamadas } = montar({ "POST /products": { corpo: { id: PRODUTO } }, "POST /checkout/sessions": SESSAO });
    await adaptador.iniciarAssinatura({ ...base, plano: { ...PLANO, intervalo: "ano" } });
    expect(chamadas[1]?.corpo.get("line_items[0][price_data][recurring][interval]")).toBe("year");
  });

  it("produto que já existe (resource_already_exists) é atualizado com o nome e o fluxo segue", async () => {
    const { adaptador, chamadas } = montar({
      "POST /products": { status: 400, corpo: { error: { code: "resource_already_exists" } } },
      [`POST /products/${PRODUTO}`]: { corpo: { id: PRODUTO } },
      "POST /checkout/sessions": SESSAO,
    });
    await adaptador.iniciarAssinatura(base);
    expect(chamadas.map((c) => c.rota)).toEqual(["POST /products", `POST /products/${PRODUTO}`, "POST /checkout/sessions"]);
    expect(chamadas[1]?.corpo.get("name")).toBe("Pro");
  });

  it("⭐ Checkout fora do ar: 3 tentativas com a MESMA Idempotency-Key, e lança transitório", async () => {
    const { adaptador, chamadas } = montar({ "POST /products": { corpo: { id: PRODUTO } }, "POST /checkout/sessions": { status: 502 } });
    const erro = await adaptador.iniciarAssinatura(base).catch((e: unknown) => e);
    expect(erro).toMatchObject({ status: 502, transitorio: true });
    const chaves = chamadas.filter((c) => c.rota === "POST /checkout/sessions").map((c) => c.headers.get("idempotency-key"));
    expect(chaves).toEqual(Array(3).fill(`${base.chaveIdempotencia}:checkout`));
  });
});
