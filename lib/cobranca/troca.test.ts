import { beforeEach, describe, expect, it, vi } from "vitest";

import { argumentos, bancoFalso, filtros, operacao, valorDoFiltro, type BancoFalso, type Cadeia, type Resposta } from "@/tests/helpers/banco-falso-da-cobranca";

vi.mock("@/lib/cobranca/provedores", () => ({
  adaptador: () => {
    throw new Error("use deps.adaptador no teste");
  },
}));

import { ErroDoProvedor, type AdaptadorDeCobranca } from "@/lib/cobranca/provedores/contrato";

import { trocarPlanoDaOrg } from "./troca";

const ORG = "eeeeeeee-0000-4000-8000-000000000001";
const AGORA = new Date("2026-10-10T12:00:00Z");
const plano = (id: string, extra: Record<string, unknown> = {}) => ({
  id, nome: id, preco_cents: 4990, intervalo: "mes", max_assentos: 5, max_canais: 2, arquivado_em: null, oferecido_ao_cliente: true, ...extra,
});
const PLANOS = [
  plano("basico"), plano("pro", { preco_cents: 9990 }), plano("mini", { max_assentos: 1 }), plano("anual", { intervalo: "ano" }),
  plano("negociado", { preco_cents: 2990, oferecido_ao_cliente: false }),
];

interface Mundo { linha: Record<string, unknown> | null; assentos: number; canais: number; casPerdido: boolean }
let m: Mundo;
let banco: BancoFalso;
const trocarNoProvedor = vi.fn<AdaptadorDeCobranca["trocarPlano"]>();

function responder(c: Cadeia): Resposta {
  if (c.tabela === "cobranca_planos") return { data: PLANOS.find((p) => p.id === valorDoFiltro(c, "eq", "id")) ?? null };
  if (c.tabela === "user_organizations") return { count: m.assentos };
  if (c.tabela === "channel_sessions") return { count: m.canais };
  if (operacao(c) === "select") return { data: m.linha };
  return m.casPerdido ? { data: null } : { data: { organization_id: ORG } };
}

const trocar = (planoId: string, origem?: "empresa" | "dono") =>
  trocarPlanoDaOrg(banco.cliente as never, ORG, planoId, {
    adaptador: () => ({ trocarPlano: trocarNoProvedor } as unknown as AdaptadorDeCobranca),
    agora: () => AGORA,
    origem,
  });
const escritas = () => banco.cadeias.filter((c) => c.tabela === "cobranca_assinaturas" && operacao(c) === "update");
const EM_TESTE = { plano_id: "basico", plano_agendado_id: null, estado: "trial", trial_ate: "2026-10-20T00:00:00Z", provedor: null, provedor_assinatura_id: null, proximo_vencimento: null, checkout_url: null };
const PAGANDO = { ...EM_TESTE, estado: "ativa", provedor: "stripe", provedor_assinatura_id: "sub_1", proximo_vencimento: "2026-11-01T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  m = { linha: { ...EM_TESTE }, assentos: 1, canais: 1, casPerdido: false };
  banco = bancoFalso(responder);
  trocarNoProvedor.mockResolvedValue(undefined);
});

describe("trocarPlanoDaOrg", () => {
  it("teste grátis sem provedor: vale na hora, por compare-and-set no plano lido", async () => {
    expect(await trocar("pro")).toMatchObject({ ok: true, changed: true, quando: "imediato", planoId: "pro" });
    expect(Object.keys(argumentos(escritas()[0]!, "update")?.[0] as object).sort()).toEqual(["plano_agendado_id", "plano_id", "updated_at"]);
    expect(filtros(escritas()[0]!)).toEqual([["eq", "organization_id", ORG], ["eq", "plano_id", "basico"], ["is", "provedor", null]]);
    expect(trocarNoProvedor).not.toHaveBeenCalled();
  });

  it("⭐ teste grátis com provedor: o preço da 1ª cobrança muda no provedor e a troca vale na hora (D-13)", async () => {
    m.linha = { ...EM_TESTE, provedor: "stripe", provedor_assinatura_id: "sub_1" };
    expect(await trocar("pro")).toMatchObject({ ok: true, quando: "imediato", planoId: "pro" });
    expect(trocarNoProvedor).toHaveBeenCalledWith({ assinaturaRef: "sub_1", plano: { id: "pro", nome: "pro", precoCents: 9990, intervalo: "mes" } });
  });

  // Divergência 44: a D-13 ("no teste, troca na hora") vale só enquanto NADA foi
  // pago. Com o 1º pagamento confirmado (checkout com < 48 h de teste cobra na
  // hora e vira `ativa`), a troca é agendada, para não reabrir o subir-no-dia-1 da D-3.
  it("⭐ pagou antes do fim do teste (estado ativa): a troca fica AGENDADA para a próxima cobrança paga (Divergência 44)", async () => {
    m.linha = { ...PAGANDO };
    expect(await trocar("pro")).toEqual({
      ok: true, changed: true, quando: "agendado", planoId: "basico", planoAgendadoId: "pro", valeAPartirDe: "2026-11-01T00:00:00Z", de: "basico",
    });
    expect(Object.keys(argumentos(escritas()[0]!, "update")?.[0] as object).sort()).toEqual(["plano_agendado_id", "updated_at"]);
    expect(trocarNoProvedor).toHaveBeenCalledOnce();
  });

  it("voltar ao plano atual desfaz o agendamento (e o preço volta no provedor)", async () => {
    m.linha = { ...PAGANDO, plano_agendado_id: "pro" };
    expect(await trocar("basico")).toMatchObject({ ok: true, quando: "agendado", planoAgendadoId: null });
    expect(argumentos(escritas()[0]!, "update")?.[0]).toMatchObject({ plano_agendado_id: null });
  });

  it.each(["em_atraso", "cancelada"])("estado %s: 409 pagamento_pendente, e o provedor nem é chamado", async (estado) => {
    m.linha = { ...PAGANDO, estado };
    expect(await trocar("pro")).toMatchObject({ ok: false, status: 409, code: "pagamento_pendente" });
    expect(trocarNoProvedor).not.toHaveBeenCalled();
  });

  it("uso acima do plano novo: 409 plan_limit_reached com o que remover, antes do provedor", async () => {
    m.assentos = 3;
    expect(await trocar("mini")).toMatchObject({ ok: false, code: "plan_limit_reached", details: { excedente: { assentos: 2 } } });
    expect(trocarNoProvedor).not.toHaveBeenCalled();
  });

  it("⭐ provedor fora do ar: 503 provedor_indisponivel e nada gravado", async () => {
    m.linha = { ...PAGANDO };
    trocarNoProvedor.mockRejectedValue(new ErroDoProvedor(503, "api_error", true));
    expect(await trocar("pro")).toMatchObject({ ok: false, status: 503, code: "provedor_indisponivel" });
    expect(escritas()).toEqual([]);
  });

  it("o provedor recusa por período corrente pendente (Asaas): 409 pagamento_pendente", async () => {
    m.linha = { ...PAGANDO };
    trocarNoProvedor.mockRejectedValue(new ErroDoProvedor(null, "pagamento_do_periodo_pendente", false));
    expect(await trocar("pro")).toMatchObject({ ok: false, status: 409, code: "pagamento_pendente" });
  });

  it("outro intervalo: 422 plano_invalido", async () => {
    expect(await trocar("anual")).toMatchObject({ ok: false, status: 422, code: "plano_invalido" });
  });

  it("⭐ plano negociado (não oferecido): a EMPRESA não o escolhe; o DONO o atribui", async () => {
    expect(await trocar("negociado")).toMatchObject({ ok: false, status: 422, code: "plano_invalido" });
    expect(await trocar("negociado", "dono")).toMatchObject({ ok: true, quando: "imediato", planoId: "negociado" });
  });
});
