/**
 * TRANSCRIÇÃO E VISÃO DE MÍDIA DEIXAM LINHA EM `llm_calls`.
 *
 * ## O defeito medido
 *
 * `workers/media-derive-worker.ts` chamava provedor pago para ler a foto
 * (`generateText`) e ouvir o áudio (a escada de transcrição) sem gravar nada em
 * `llm_calls`: Uso de IA e a régua do teto (`fn_gasto_de_ia_do_mes`) somavam
 * zero para toda mídia.
 *
 * ## Como se prova
 *
 * Pelas deps que o worker REAL entrega a `deriveMediaText` (o mesmo recorte de
 * `midia-base-url-do-binding.test.ts`): chama-se a visão e o transcriber que ele
 * montou e lê-se o que caiu na tabela.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ModuloDeTranscricao from "@/lib/messaging/media/transcription";

const downloadMock = vi.fn();
const factoryMock = vi.fn(() => "modelo-de-mentira");
const transcribeDoSvcMock = vi.fn(async () => "transcrição de mentira");
const llmCalls: Array<Record<string, unknown>> = [];

let linhaDaMensagem: Record<string, unknown> = {};
const BINDING = {
  provider: "openrouter",
  model_id: "acme/visao-1",
  credential_id: "cred-1",
  base_url: null,
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const linha =
        tabela === "ai_purpose_bindings"
          ? BINDING
          : tabela === "agent_inbox_items"
            ? null
            : linhaDaMensagem;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const terminais: any = {
        maybeSingle: async () => ({ data: linha, error: null }),
        single: async () => ({ data: linha, error: null }),
        insert: async (row: Record<string, unknown>) => {
          if (tabela === "llm_calls") llmCalls.push(row);
          return { error: null };
        },
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: linha ? [linha] : [], error: null }).then(resolve),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = new Proxy(terminais, {
        get: (alvo, prop) => (prop in alvo ? alvo[prop as keyof typeof alvo] : () => chain),
      });
      return chain;
    },
    storage: { from: () => ({ download: downloadMock }) },
  }),
}));

vi.mock("@/lib/messaging/media/derive", () => ({
  deriveMediaText: vi.fn(async () => "derivado de mentira"),
}));

vi.mock("@/lib/agent-engine/edge/llm/credentials", () => ({
  resolveOrgLlmConfig: vi.fn(async () => ({
    provider: "openrouter",
    apiKey: "chave-do-binding",
    origemDaChave: "credencial_da_organizacao",
    defaultModel: "gpt-5",
    params: {},
    enabledModels: [],
    orcamento: { modo: "off", tetoCents: 0, efetivoEm: null, limiarPct: 80 },
    orcamentoIndisponivelPorque: null,
  })),
}));

vi.mock("@/lib/agent-engine/edge/llm/providers", () => ({
  createDefaultRegistry: () => ({
    openrouter: factoryMock,
    openai: factoryMock,
    anthropic: factoryMock,
    google: factoryMock,
  }),
}));

vi.mock("@/lib/ai/pontos/capacidade-em-vigor", () => ({
  visaoEmVigor: vi.fn(async () => ({ enxerga: true, sabemos: true })),
}));

// O preço sai da régua de sempre; aqui só importa que ele chega à linha.
vi.mock("@/lib/ai/cost", () => ({ computeCost: vi.fn(async () => 0.42) }));

vi.mock("ai", () => ({ generateText: vi.fn() }));

vi.mock("@/lib/messaging/media/transcription", async (importOriginal) => ({
  ...(await importOriginal<typeof ModuloDeTranscricao>()),
  apiTranscriptionProvider: () => ({ transcribe: transcribeDoSvcMock }),
}));

import { generateText } from "ai";

import { computeCost } from "@/lib/ai/cost";
import { deriveMediaText, type DeriveDeps } from "@/lib/messaging/media/derive";
import { deriveMessageMedia } from "@/workers/media-derive-worker";

function eventRow() {
  return {
    id: "ev1",
    organization_id: "org1",
    event_type: "media.derive_requested",
    entity_kind: "message",
    entity_id: "msg1",
    payload: { message_id: "msg1" },
    metadata: {},
    consumed_by: [],
    attempts: 0,
  };
}

function depsDaChamada(): DeriveDeps {
  const deps = vi.mocked(deriveMediaText).mock.calls[0]?.[3];
  if (!deps) throw new Error("deriveMediaText não foi chamado: a derivação parou antes das deps");
  return deps;
}

function mensagem(tipo: "image" | "audio") {
  linhaDaMensagem = {
    id: "msg1",
    organization_id: "org1",
    type: tipo,
    media_mime: tipo === "image" ? "image/jpeg" : "audio/ogg",
    media_storage_path: tipo === "image" ? "org1/conv1/msg1.jpg" : "org1/conv1/msg1.ogg",
    media_derived_status: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  llmCalls.length = 0;
  downloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new ArrayBuffer(8) }, error: null });
  vi.mocked(generateText).mockResolvedValue({
    text: "uma caixa de sapatos aberta",
    usage: { inputTokens: 1200, outputTokens: 30 },
  } as unknown as Awaited<ReturnType<typeof generateText>>);
});

describe("worker de mídia: o gasto aparece em llm_calls", () => {
  it("visão de imagem grava tokens e custo pela régua de preço", async () => {
    mensagem("image");
    await deriveMessageMedia(eventRow());

    await expect(depsDaChamada().describeImage(Buffer.from("jpeg"), "image/jpeg")).resolves.toBe(
      "uma caixa de sapatos aberta",
    );

    expect(computeCost).toHaveBeenCalledWith({
      model: "acme/visao-1",
      promptTokens: 1200,
      completionTokens: 30,
    });
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toMatchObject({
      organization_id: "org1",
      purpose: "visao_de_imagem",
      provider: "openrouter",
      model: "acme/visao-1",
      input_tokens: 1200,
      output_tokens: 30,
      cost_cents: 0.42,
      status: "ok",
    });
  });

  it("visão que falha vira linha de erro e a falha segue para quem chamou", async () => {
    mensagem("image");
    vi.mocked(generateText).mockRejectedValue(new Error("Insufficient credits"));
    await deriveMessageMedia(eventRow());

    await expect(depsDaChamada().describeImage(Buffer.from("jpeg"), "image/jpeg")).rejects.toThrow(
      "Insufficient credits",
    );
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toMatchObject({ purpose: "visao_de_imagem", status: "erro" });
  });

  it("transcrição de áudio grava a chamada com o par do degrau e custo 0 declarado", async () => {
    mensagem("audio");
    await deriveMessageMedia(eventRow());

    await expect(depsDaChamada().transcriber.transcribe(Buffer.from("ogg"), "audio/ogg")).resolves.toBe(
      "transcrição de mentira",
    );
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toMatchObject({
      organization_id: "org1",
      purpose: "transcricao_de_audio",
      provider: "openai",
      input_tokens: 0,
      output_tokens: 0,
      // Limitação declarada: a interface de transcrição não devolve uso.
      cost_cents: 0,
      status: "ok",
    });
    expect(typeof llmCalls[0]!.model).toBe("string");
    expect(llmCalls[0]!.model).not.toBe("");
  });

  it("transcrição que falha vira linha de erro e a falha segue", async () => {
    mensagem("audio");
    transcribeDoSvcMock.mockRejectedValueOnce(new Error("Incorrect API key provided"));
    await deriveMessageMedia(eventRow());

    await expect(depsDaChamada().transcriber.transcribe(Buffer.from("ogg"), "audio/ogg")).rejects.toThrow(
      "Incorrect API key provided",
    );
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toMatchObject({ purpose: "transcricao_de_audio", status: "erro" });
  });
});
