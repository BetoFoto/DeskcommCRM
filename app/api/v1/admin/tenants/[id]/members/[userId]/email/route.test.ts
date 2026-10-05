/**
 * PATCH .../members/[userId]/email — o admin da plataforma corrige o e-mail de
 * login de um membro.
 *
 * O que não pode regredir:
 *  - a troca vai ao GoTrue com `email_confirm: true` (sem SMTP, a confirmação
 *    no endereço novo nunca chegaria);
 *  - e-mail já usado por outro login vira 409 com mensagem clara, não 500;
 *  - o alvo precisa pertencer ao tenant do path;
 *  - admin da plataforma não tem o e-mail trocado por outro admin (tomada de conta);
 *  - a auditoria guarda só HASH, nunca o endereço em claro;
 *  - as três guardas da decisão do dono: (a) a troca abre um aviso na Central
 *    da empresa, com o nome e a data e NUNCA um endereço, antes do GoTrue — e o
 *    aviso é desfeito se o GoTrue recusar; (b) o endereço ANTIGO é avisado,
 *    com a marca da instalação, e a falta de envio configurado não derruba a
 *    troca; (c) quem tem fator prova a segunda etapa nesta sessão.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// A guarda de escrita NÃO é mockada: o teste substitui só o que ela consulta
// (a sessão, a linha de `platform_admins` e a dívida de MFA), e assim trocar
// `requirePlatformAdminEscrita` por outra guarda reprova aqui.
const g = vi.hoisted(() => ({
  linhaDoAdmin: null as Record<string, unknown> | null,
  mfaEmDivida: vi.fn(async () => false),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
}));
vi.mock("@/lib/auth/server", () => ({ mfaEmDivida: g.mfaEmDivida }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } } }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1" } }) },
    },
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.is = () => c;
      c.maybeSingle = async () => ({ data: g.linhaDoAdmin, error: null });
      return c;
    },
  }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  hashEmail: (e: string) => `h${e.length}`,
}));
vi.mock("@/lib/email/roteador", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/branding/saida", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  marcaDaSaida: vi.fn(async () => ({
    nome: "Marca X",
    logoUrl: null,
    accent: "#123456",
    accentFg: "#ffffff",
    origens: { nome: "instalacao", cor: "instalacao" },
  })),
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email/roteador";
import { createAdminClient } from "@/lib/supabase/admin";

import { PATCH } from "./route";

const ORG = "22222222-2222-4222-8222-222222222222";
const ALVO = "33333333-3333-4333-8333-333333333333";
const ADMIN = "11111111-1111-4111-8111-111111111111";

const passos: string[] = [];

function adminFalso(opts: {
  membro?: boolean;
  ehAdminDaPlataforma?: boolean;
  emailAtual?: string;
  nome?: string | null;
  erroNoUpdate?: { code?: string; message: string } | null;
  erroNaCentral?: boolean;
  erroEmPlatformAdmins?: boolean;
}) {
  const updateUserById = vi.fn(async () => {
    passos.push("gotrue.update");
    return { data: {}, error: opts.erroNoUpdate ?? null };
  });
  const insercoes: Array<Record<string, unknown>> = [];
  const remocoes: string[] = [];
  const leitura = (data: unknown, error: { message: string } | null = null) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.is = () => b;
    b.maybeSingle = async () => ({ data: error ? null : data, error });
    return b;
  };
  const central = () => {
    const b: Record<string, unknown> = {};
    b.insert = (linha: Record<string, unknown>) => {
      passos.push("central.insert");
      insercoes.push(linha);
      return b;
    };
    b.select = () => b;
    b.single = async () =>
      opts.erroNaCentral
        ? { data: null, error: { message: "boom" } }
        : { data: { id: "item-1" }, error: null };
    b.delete = () => b;
    b.eq = (col: string, val: string) => {
      if (col === "id") {
        passos.push("central.delete");
        remocoes.push(val);
      }
      return b;
    };
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r);
    return b;
  };
  const admin = {
    from: (t: string) => {
      if (t === "user_organizations") return leitura(opts.membro === false ? null : { user_id: ALVO });
      if (t === "platform_admins")
        return leitura(
          opts.ehAdminDaPlataforma ? { user_id: ALVO } : null,
          opts.erroEmPlatformAdmins ? { message: "statement timeout" } : null,
        );
      if (t === "organizations") return leitura({ timezone: "America/Sao_Paulo" });
      if (t === "agent_inbox_items") return central();
      throw new Error(`tabela inesperada: ${t}`);
    },
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: {
            user: {
              id: ALVO,
              email: opts.emailAtual ?? "errado@exemplo.com",
              user_metadata: opts.nome === null ? {} : { full_name: opts.nome ?? "Maria Souza" },
            },
          },
          error: null,
        })),
        updateUserById,
      },
    },
  };
  vi.mocked(createAdminClient).mockReturnValue(admin as never);
  return { updateUserById, insercoes, remocoes };
}

function pedir(email: unknown) {
  return PATCH(
    new NextRequest(`http://x/api/v1/admin/tenants/${ORG}/members/${ALVO}/email`, {
      method: "PATCH",
      body: JSON.stringify({ email }),
    }),
    { params: Promise.resolve({ id: ORG, userId: ALVO }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  passos.length = 0;
  vi.mocked(sendEmail).mockImplementation(async () => {
    passos.push("email.antigo");
    return { ok: true, id: "m1", via: "resend" };
  });
  g.linhaDoAdmin = { user_id: ADMIN, scope: "full", mfa_required: false, revoked_at: null };
  g.mfaEmDivida.mockResolvedValue(false);
});

describe("troca de e-mail de membro", () => {
  it("troca no GoTrue com email_confirm e normaliza para minúsculas", async () => {
    const { updateUserById } = adminFalso({});
    const res = await pedir("  Certo@Exemplo.COM ");
    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(ALVO, {
      email: "certo@exemplo.com",
      email_confirm: true,
    });
  });

  it("audita só hashes — o e-mail em claro não entra no registro", async () => {
    adminFalso({});
    await pedir("certo@exemplo.com");
    const chamada = vi.mocked(audit).mock.calls[0]![0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(chamada.action).toBe("member.email_changed");
    expect(JSON.stringify(chamada.metadata)).not.toContain("certo@exemplo.com");
    expect(chamada.metadata.email_hash_novo).toBe(`h${"certo@exemplo.com".length}`);
  });

  it("e-mail já usado por outro login: 409, sem 500", async () => {
    adminFalso({
      erroNoUpdate: {
        code: "email_exists",
        message: "A user with this email address has already been registered",
      },
    });
    const res = await pedir("ocupado@exemplo.com");
    expect(res.status).toBe(409);
  });

  it("mesmo e-mail de hoje: 409 e nenhuma chamada ao GoTrue", async () => {
    const { updateUserById } = adminFalso({ emailAtual: "igual@exemplo.com" });
    const res = await pedir("IGUAL@exemplo.com");
    expect(res.status).toBe(409);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("formato inválido: 400", async () => {
    adminFalso({});
    expect((await pedir("nao-e-email")).status).toBe(400);
  });

  it("quem não é membro deste tenant: 404", async () => {
    const { updateUserById } = adminFalso({ membro: false });
    expect((await pedir("certo@exemplo.com")).status).toBe(404);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("admin da plataforma: 403 — não se toma a conta de outro admin por aqui", async () => {
    const { updateUserById } = adminFalso({ ehAdminDaPlataforma: true });
    expect((await pedir("certo@exemplo.com")).status).toBe(403);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("a leitura de platform_admins falha: 500 e nada é trocado — a guarda contra tomada de conta falha FECHADA", async () => {
    const { updateUserById, insercoes } = adminFalso({ ehAdminDaPlataforma: true, erroEmPlatformAdmins: true });
    expect((await pedir("certo@exemplo.com")).status).toBe(500);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(insercoes).toHaveLength(0);
  });

  it("admin com fator TOTP e sessão aal1: 403 mfa_required, nada é trocado", async () => {
    const { updateUserById } = adminFalso({});
    g.mfaEmDivida.mockResolvedValue(true);
    const res = await pedir("certo@exemplo.com");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("mfa_required");
    expect(updateUserById).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("admin sem fator cadastrado: a troca segue — a política de MFA é opcional", async () => {
    const { updateUserById } = adminFalso({});
    g.mfaEmDivida.mockResolvedValue(false);
    expect((await pedir("certo@exemplo.com")).status).toBe(200);
    expect(updateUserById).toHaveBeenCalledTimes(1);
  });

  it("acesso de suporte (support_readonly): 403 forbidden_scope, nada é trocado", async () => {
    const { updateUserById } = adminFalso({});
    g.linhaDoAdmin = { user_id: ADMIN, scope: "support_readonly", mfa_required: false, revoked_at: null };
    const res = await pedir("certo@exemplo.com");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden_scope");
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("(a) a Central da empresa recebe UM aviso com o nome — e nenhum endereço", async () => {
    const { insercoes } = adminFalso({ emailAtual: "antigo@exemplo.com" });
    expect((await pedir("novo@exemplo.com")).status).toBe(200);
    expect(insercoes).toHaveLength(1);
    const item = insercoes[0]!;
    expect(item).toMatchObject({
      organization_id: ORG,
      kind: "email_de_login_trocado",
      severity: "warn",
    });
    const texto = `${String(item.title)} ${String(item.body)}`;
    expect(texto).toContain("Maria Souza");
    expect(texto).not.toContain("@");
  });

  it("(a) sem nome no cadastro, o aviso diz 'uma pessoa da equipe' — nunca cai para o e-mail", async () => {
    const { insercoes } = adminFalso({ nome: null });
    await pedir("novo@exemplo.com");
    expect(String(insercoes[0]!.body)).toContain("uma pessoa da equipe");
    expect(String(insercoes[0]!.body)).not.toContain("@");
  });

  it("(a) nome que é um endereço também não vaza", async () => {
    const { insercoes } = adminFalso({ nome: "maria@exemplo.com" });
    await pedir("novo@exemplo.com");
    expect(`${String(insercoes[0]!.title)} ${String(insercoes[0]!.body)}`).not.toContain("@");
  });

  it("(a) o aviso nasce ANTES da troca; se ele falha, nada é trocado (500)", async () => {
    const { updateUserById } = adminFalso({ erroNaCentral: true });
    const res = await pedir("novo@exemplo.com");
    expect(res.status).toBe(500);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("(a) o GoTrue recusa (e-mail em uso): 409 e o aviso recém-criado é desfeito", async () => {
    const { remocoes } = adminFalso({
      erroNoUpdate: { code: "email_exists", message: "already been registered" },
    });
    expect((await pedir("ocupado@exemplo.com")).status).toBe(409);
    expect(remocoes).toEqual(["item-1"]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("(b) o endereço ANTIGO é avisado, depois da troca, com a marca da instalação no remetente", async () => {
    adminFalso({ emailAtual: "antigo@exemplo.com" });
    await pedir("novo@exemplo.com");
    expect(passos).toEqual(["central.insert", "gotrue.update", "email.antigo"]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const envio = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(envio.to).toBe("antigo@exemplo.com");
    expect(envio.fromName).toBe("Marca X");
    expect(`${envio.subject} ${envio.html} ${envio.text ?? ""}`).not.toContain("novo@exemplo.com");
  });

  it("(b) sem envio configurado: a troca segue (200) e o registro diz que o aviso não saiu", async () => {
    const { updateUserById } = adminFalso({});
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "not_configured" });
    expect((await pedir("novo@exemplo.com")).status).toBe(200);
    expect(updateUserById).toHaveBeenCalledTimes(1);
    const chamada = vi.mocked(audit).mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(chamada.metadata).toMatchObject({
      aviso_na_central: "item-1",
      aviso_ao_endereco_antigo: "sem_envio_configurado",
    });
  });

  it("(b) o envio que LANÇA também não derruba a troca", async () => {
    adminFalso({});
    vi.mocked(sendEmail).mockRejectedValue(new Error("smtp caiu"));
    expect((await pedir("novo@exemplo.com")).status).toBe(200);
    const chamada = vi.mocked(audit).mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(chamada.metadata.aviso_ao_endereco_antigo).toBe("falhou");
  });
});
