/**
 * CUIDAR DA EQUIPE PELO CELULAR (ADR-0006, fase F4) — medido por geometria.
 *
 * O gestor abre no celular as telas de quem cuida do time: Equipe (membros e
 * convites), a aba Atendimento (plantão e horários), os pedidos de LGPD e as
 * etiquetas. Abaixo de `md` as tabelas viram cartão só com classes `max-md:`
 * (o DOM é o do computador), e as etiquetas, que eram uma `<table>` crua dentro
 * de um `Card` com `overflow-hidden`, perdiam Renomear, Juntar e Excluir pela
 * direita, sem barra de rolagem.
 *
 * ═══ Por que "o <main> não transborda" não basta ═════════════════════════════
 *
 * `components/ui/table.tsx` embrulha toda `<Table>` num `div.overflow-auto`: a
 * tabela larga rola DENTRO dele e nunca alarga o `<main>`. A régua do `<main>`
 * fica verde com ou sem cartão. Então cada cartão tem asserção própria: o
 * `thead` com `display: none`, o invólucro da tabela sem rolagem lateral e a
 * ação com `right <= 390`. As etiquetas não usam o primitivo; ali o que prova é
 * o «Excluir» dentro da tela — e esse caso falha sem o conserto, porque o
 * `Card` corta a tabela.
 *
 * ═══ O que esta spec NÃO cobre, de propósito ═════════════════════════════════
 *
 * A área de toque do interruptor de Disponibilidade (ele desenha 20px). Ela
 * depende do `Switch` com área expandida, que é outro PR da F4; aqui só se
 * prova que o interruptor fica dentro da tela. Também não prova o Safari do
 * iPhone: é Chromium de computador com `isMobile` + `hasTouch`, EMULADO.
 *
 * ═══ Dados ═══════════════════════════════════════════════════════════════════
 *
 * Os membros são os do seed de credenciais (admin, manager, agent, viewer,
 * dono). Pelo service role semeia-se, e apaga-se no fim: um convite pendente
 * cujo e-mail não saiu (o CI não tem Resend), um pedido de LGPD já concluído
 * com vencimento antigo (a lista ordena por vencimento, então ele abre a
 * primeira página) e um contato com uma etiqueta própria. Nada de WAHA.
 *
 * Um login (admin) num caso só: ver `e2e-dois-logins-nao-cabem-no-teto-padrao`.
 */
import { mkdirSync } from "node:fs";
import * as path from "node:path";

import { test, type Locator, type Page } from "./helpers/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";
import { admin, creds, expect, insere, type Creds } from "./qa-l12-comum";

const EVIDENCIA = path.join(process.cwd(), "evidence", "equipe-no-celular-20261023");

/** O piso de alvo de toque, o mesmo de `celular-cabe-na-tela.spec.ts`. */
const PISO_DE_TOQUE = 44;
const LARGURA = 390;

const MARCA = `${Date.now()}`.slice(-7);
const CONVITE = `convite.celular.${MARCA}@um-dominio-bem-comprido-de-teste.com.br`;
/** A tela mostra os 16 primeiros caracteres do sujeito. */
const SUJEITO = `cel-${MARCA}`;
const ETIQUETA = `etq-celular-${MARCA}`;

test.use({ viewport: { width: LARGURA, height: 844 }, hasTouch: true, isMobile: true, locale: "pt-BR" });

async function medir(alvo: Locator) {
  return alvo.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, height: r.height };
  });
}

/** O que rola para o lado dentro do <main> do AppShell (o body não enxerga). */
async function rolagemDoMain(page: Page) {
  return page.locator("main").first().evaluate((m) => m.scrollWidth - m.clientWidth);
}

/** O cartão de verdade: cabeçalho fora e o invólucro do primitivo sem rolar. */
async function esperarCartao(tabela: Locator, nome: string) {
  expect(
    await tabela.locator("thead").evaluate((el) => getComputedStyle(el).display),
    `${nome}: o cabeçalho da tabela continua à vista`,
  ).toBe("none");
  const rolagem = await tabela.evaluate((t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth);
  expect(rolagem, `${nome}: a tabela rola para o lado dentro da própria caixa`).toBeLessThanOrEqual(1);
}

async function esperarAlvoNaTela(alvo: Locator, nome: string) {
  const r = await medir(alvo);
  expect(r.height, `${nome}: altura`).toBeGreaterThanOrEqual(PISO_DE_TOQUE);
  expect(r.width, `${nome}: largura`).toBeGreaterThanOrEqual(PISO_DE_TOQUE);
  expect(r.left, `${nome}: passa da borda esquerda`).toBeGreaterThanOrEqual(0);
  expect(r.right, `${nome}: passa da borda direita`).toBeLessThanOrEqual(LARGURA);
}

test.describe("cuidar da equipe pelo celular", () => {
  test.describe.configure({ timeout: 180_000 });

  let c: Creds;
  let conviteId = "";
  let pedidoId = "";
  let contatoId = "";

  test.beforeAll(async () => {
    lerCreds();
    c = creds();
    conviteId = await insere("team_invites", {
      organization_id: c.org_id,
      email: CONVITE,
      role: "agent",
      email_dispatched: false,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    pedidoId = await insere("lgpd_requests", {
      organization_id: c.org_id,
      request_type: "data_request",
      source: "manual",
      external_customer_id: SUJEITO,
      status: "completed",
      completed_at: new Date().toISOString(),
      due_at: "2001-01-02T12:00:00Z",
    });
    contatoId = await insere("contacts", {
      organization_id: c.org_id,
      name: `Etiqueta Celular ${MARCA}`,
      tags: [ETIQUETA],
    });
  });

  test.afterAll(async () => {
    if (conviteId) await admin.from("team_invites").delete().eq("id", conviteId);
    if (pedidoId) await admin.from("lgpd_requests").delete().eq("id", pedidoId);
    if (contatoId) await admin.from("contacts").delete().eq("id", contatoId);
  });

  test("[P1] equipe, plantão, LGPD e etiquetas cabem a 390px e as ações ficam ao alcance", async ({ page }) => {
    mkdirSync(EVIDENCIA, { recursive: true });
    await loginComoAdmin(page, lerCreds());
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const emailDoAgente = c.users.agent!.email;

    // ── 1. Membros ─────────────────────────────────────────────────────────
    await page.goto("/app/team");
    const painel = page.getByRole("tabpanel");
    const membros = painel.locator("table").first();
    const linhaDoAgente = membros.locator("tbody tr").filter({ hasText: emailDoAgente });
    await expect(linhaDoAgente).toBeVisible({ timeout: 30_000 });
    expect(await rolagemDoMain(page), "membros: o <main> rola para o lado").toBeLessThanOrEqual(1);
    await esperarCartao(membros, "membros");
    await esperarAlvoNaTela(linhaDoAgente.getByRole("button", { name: "Ações" }), "membros: ⋯");

    // ── 2. Convites ────────────────────────────────────────────────────────
    const convites = painel.locator("section").filter({ hasText: "Convites" }).locator("table");
    const linhaDoConvite = convites.locator("tbody tr").filter({ hasText: CONVITE });
    await expect(linhaDoConvite).toBeVisible({ timeout: 30_000 });
    await esperarCartao(convites, "convites");
    await esperarAlvoNaTela(linhaDoConvite.getByRole("button", { name: "Copiar link" }), "convites: Copiar link");
    await esperarAlvoNaTela(linhaDoConvite.getByRole("button", { name: "Ações" }), "convites: ⋯");
    await page.screenshot({ path: path.join(EVIDENCIA, "01-membros-e-convites.png"), fullPage: true });

    // ── 3. Atendimento: plantão e horário ──────────────────────────────────
    // `click`, não `tap`: o gatilho de aba do Radix ativa no `mousedown`.
    await page.getByRole("tab", { name: "Atendimento" }).click();
    await expect(page.getByTestId("atendentes-e-horarios")).toBeVisible({ timeout: 20_000 });
    const atendentes = page.getByRole("tabpanel").locator("table");
    const atendente = atendentes.locator("tbody tr").filter({ hasText: emailDoAgente });
    await expect(atendente).toBeVisible({ timeout: 20_000 });
    expect(await rolagemDoMain(page), "atendimento: o <main> rola para o lado").toBeLessThanOrEqual(1);
    await esperarCartao(atendentes, "atendimento");
    // Só a posição: a área de toque do interruptor é de outro PR (ver o cabeçalho).
    const chave = await medir(atendente.getByRole("switch", { name: /^Disponibilidade de / }));
    expect(chave.left, "o interruptor passa da borda esquerda").toBeGreaterThanOrEqual(0);
    expect(chave.right, "o interruptor passa da borda direita").toBeLessThanOrEqual(LARGURA);
    const editar = atendente.getByRole("button", { name: /^Editar horário de / });
    await esperarAlvoNaTela(editar, "Editar horário");
    await page.screenshot({ path: path.join(EVIDENCIA, "02-atendimento.png"), fullPage: true });

    // O editor de horários: a linha da janela cabe no diálogo, e cada campo
    // de hora mostra o horário inteiro. Fecha em Cancelar, sem gravar nada.
    await editar.tap();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    if ((await dialogo.getByTestId("janela").count()) === 0) {
      await dialogo.getByRole("button", { name: "Adicionar janela" }).tap();
    }
    const janela = dialogo.getByTestId("janela").first();
    await expect(janela).toBeVisible();
    const caixaDoDialogo = await medir(dialogo);
    const caixaDaJanela = await medir(janela);
    expect(caixaDaJanela.right, "a linha da janela passa da borda do diálogo").toBeLessThanOrEqual(
      caixaDoDialogo.right,
    );
    expect(await janela.evaluate((el) => el.scrollWidth - el.clientWidth), "a linha da janela estoura").toBeLessThanOrEqual(
      1,
    );
    for (const campo of await janela.locator('input[type="time"]').all()) {
      const sobra = await campo.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(sobra, "o campo de hora corta o horário").toBeLessThanOrEqual(0);
      expect((await medir(campo)).right, "o campo de hora passa da borda do diálogo").toBeLessThanOrEqual(
        caixaDoDialogo.right,
      );
    }
    await page.screenshot({ path: path.join(EVIDENCIA, "03-editor-de-horario.png") });
    await dialogo.getByRole("button", { name: "Cancelar" }).tap();
    await expect(dialogo).toBeHidden();

    // ── 4. Pedidos de LGPD ─────────────────────────────────────────────────
    await page.goto("/app/lgpd/requests");
    const pedidos = page.locator("table").first();
    const pedido = pedidos.locator("tbody tr").filter({ hasText: SUJEITO });
    await expect(pedido).toBeVisible({ timeout: 30_000 });
    expect(await rolagemDoMain(page), "LGPD: o <main> rola para o lado").toBeLessThanOrEqual(1);
    await esperarCartao(pedidos, "LGPD");
    await esperarAlvoNaTela(pedido.getByRole("link", { name: "Ver" }), "LGPD: Ver");
    await page.screenshot({ path: path.join(EVIDENCIA, "04-lgpd.png"), fullPage: true });

    // ── 5. Etiquetas: o bloqueio ───────────────────────────────────────────
    await page.goto(`/app/settings/tags?busca=${ETIQUETA}`);
    const etiqueta = page.locator("tbody tr").filter({ hasText: ETIQUETA });
    await expect(etiqueta).toBeVisible({ timeout: 30_000 });
    expect(await rolagemDoMain(page), "etiquetas: o <main> rola para o lado").toBeLessThanOrEqual(1);
    for (const acao of ["Cor", "Renomear", "Juntar", "Excluir"]) {
      const r = await medir(etiqueta.getByRole("button", { name: acao, exact: true }));
      expect(r.right, `etiquetas: «${acao}» cortado pela direita`).toBeLessThanOrEqual(LARGURA);
      expect(r.height, `etiquetas: «${acao}» altura`).toBeGreaterThanOrEqual(PISO_DE_TOQUE);
    }
    await page.screenshot({ path: path.join(EVIDENCIA, "05-etiquetas.png"), fullPage: true });

    // ── Controle: no computador as colunas de contagem voltam ──────────────
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("columnheader", { name: "Leads" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Regras de agente" })).toBeVisible();
  });
});
