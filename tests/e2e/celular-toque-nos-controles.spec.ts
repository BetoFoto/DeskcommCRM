/**
 * OS CONTROLES DA CASCA ATENDEM O DEDO (ADR-0006, fase F4) — medido por geometria.
 *
 * Os primitivos (`Switch`, itens de menu, abas) e a casca (gaveta "Mais", busca)
 * aparecem em quase toda tela. Esta spec mede, a 390 px com toque, o que o
 * conserto promete a quem usa o celular:
 *
 * 1. o interruptor pega o toque 21 px abaixo do centro (alvo de 44 px; a caixa
 *    desenhada continua com 20) e NÃO pega a 24 px — o controle negativo, que
 *    separa "a área cresceu para 44" de "a área cresceu para qualquer coisa";
 * 2. todo item do menu do usuário tem 44 px de altura;
 * 3. todo link e cabeçalho de grupo da gaveta "Mais" tem 44 px;
 * 4. a aba é atingível 2 px dentro da borda de cima e da de baixo. Com a fila de
 *    abas em `h-9` e `overflow-x-auto` (que força o `overflow-y` a rolar), a aba
 *    de 44 px ficava CORTADA 4 px em cima e 4 px embaixo: o
 *    `getBoundingClientRect` dizia 44 e o dedo na borda caía fora. Por isso a
 *    régua é `elementFromPoint`, e a 2 px (e não a 4, que cairia exatamente na
 *    linha do corte e não distinguiria antes de depois);
 * 5. na busca, tocar no centro de "Limpar" esvazia o campo e a busca continua
 *    aberta — antes o toque caía no X do diálogo (44 px de alvo no celular) e
 *    fechava tudo;
 * 6. CONTROLE do computador, num caso à parte (1280 px, mouse, sem toque): o
 *    item de menu continua com a altura de sempre, abaixo de 44.
 *
 * `elementFromPoint` aceita o próprio elemento ou um descendente; o PAI não
 * conta, senão a célula da tabela em volta do interruptor passaria.
 *
 * Nada é semeado: as telas usadas (Configurações › Notificações, Equipe, a casca)
 * existem para o admin de toda parte comum, e nenhum caso grava nada — o
 * interruptor é medido, não alternado, e o "Sair" do menu nunca é tocado.
 *
 * ⚠️ EMULAÇÃO, DECLARADA: Chromium de computador com `isMobile` + `hasTouch`.
 * Prova a regra da tela, não o Safari do iPhone.
 *
 * Dois logins (um por caso): o teto abaixo cobre o padrão mais a janela TOTP,
 * como pede `tests/unit/e2e-dois-logins-nao-cabem-no-teto-padrao.test.ts`.
 */
import { mkdirSync } from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "./helpers/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const EVIDENCIA = path.join(process.cwd(), "evidence", "celular-f4-casca");

/** O piso de alvo de toque, o mesmo de `celular-cabe-na-tela.spec.ts`. */
const PISO_DE_TOQUE = 44;

test.describe.configure({ timeout: 120_000 });

const creds = lerCreds();

/**
 * O que o dedo acerta na coluna do centro do alvo, `dy` px a partir do centro,
 * da borda de cima ou da de baixo. Verdadeiro só para o próprio elemento ou um
 * descendente.
 */
async function acerta(
  page: Page,
  seletor: string,
  pontos: Array<{ de: "centro" | "topo" | "base"; dy: number }>,
): Promise<boolean[]> {
  return page.locator(seletor).evaluate(
    (el, pts) => {
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      return pts.map(({ de, dy }) => {
        const y = (de === "centro" ? r.top + r.height / 2 : de === "topo" ? r.top : r.bottom) + dy;
        const alvo = document.elementFromPoint(cx, y);
        return alvo !== null && (alvo === el || el.contains(alvo));
      });
    },
    pontos,
  );
}

async function alturas(page: Page, seletor: string): Promise<Array<{ texto: string; h: number }>> {
  return page.locator(seletor).evaluateAll((els) =>
    els
      .map((el) => ({ texto: (el.textContent ?? "").trim().slice(0, 40), h: el.getBoundingClientRect().height }))
      .filter((x) => x.h > 0),
  );
}

test.describe("no celular, com o dedo", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "pt-BR" });

  test("[P1] interruptor, menu, gaveta, aba e busca têm alvo de dedo", async ({ page }) => {
    mkdirSync(EVIDENCIA, { recursive: true });
    await loginComoAdmin(page, creds);
    // Sem toque emulado o `pointer-coarse:` não vale, e o caso mediria o mouse.
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

    // 1. O interruptor in_app (o de e-mail é `disabled`: medir um controle morto
    //    não provaria nada).
    await page.goto("/app/settings/notifications");
    const interruptor = '[role="switch"][aria-label="Lead ganho via in_app"]';
    await expect(page.locator(interruptor)).toBeVisible({ timeout: 30_000 });
    const [a21, a24] = await acerta(page, interruptor, [
      { de: "centro", dy: 21 },
      { de: "centro", dy: 24 },
    ]);
    expect(a21, "o toque 21 px abaixo do centro do interruptor não chega nele").toBe(true);
    expect(a24, "controle: a 24 px a área já devia ter acabado (44 px, não mais)").toBe(false);
    await page.screenshot({ path: path.join(EVIDENCIA, "01-interruptor.png") });

    // 2. O menu do usuário.
    await page.getByRole("button", { name: "Menu do usuário" }).tap();
    const itens = await alturas(page, '[role="menuitem"]');
    expect(itens.length, "o menu do usuário não abriu").toBeGreaterThan(0);
    for (const { texto, h } of itens) expect(h, `item de menu "${texto}"`).toBeGreaterThanOrEqual(PISO_DE_TOQUE);
    await page.screenshot({ path: path.join(EVIDENCIA, "02-menu-do-usuario.png") });
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="menu"]')).toHaveCount(0);

    // 3. A gaveta "Mais" da barra de abas.
    await page.locator("nav[data-barra-inferior]").getByRole("button", { name: "Mais" }).tap();
    const gaveta = page.getByRole("dialog");
    await expect(gaveta).toBeVisible();
    const links = await alturas(page, '[role="dialog"] a[href]');
    expect(links.length, "a gaveta abriu sem links").toBeGreaterThan(0);
    for (const { texto, h } of links) expect(h, `link da gaveta "${texto}"`).toBeGreaterThanOrEqual(PISO_DE_TOQUE);
    for (const { texto, h } of await alturas(page, '[role="dialog"] h2 > button')) {
      expect(h, `cabeçalho de grupo "${texto}"`).toBeGreaterThanOrEqual(PISO_DE_TOQUE);
    }
    await page.screenshot({ path: path.join(EVIDENCIA, "03-gaveta.png") });
    await page.keyboard.press("Escape");
    await expect(gaveta).toHaveCount(0);

    // 4. A aba, perto das bordas.
    await page.goto("/app/team");
    const aba = '[role="tab"]:has-text("Atendimento")';
    await expect(page.locator(aba)).toBeVisible({ timeout: 30_000 });
    expect((await page.locator(aba).boundingBox())!.height).toBeGreaterThanOrEqual(PISO_DE_TOQUE);
    const [topo, base] = await acerta(page, aba, [
      { de: "topo", dy: 2 },
      { de: "base", dy: -2 },
    ]);
    expect(topo, "a borda de cima da aba está cortada pela fila").toBe(true);
    expect(base, "a borda de baixo da aba está cortada pela fila").toBe(true);
    await page.screenshot({ path: path.join(EVIDENCIA, "04-abas.png") });

    // 5. A busca: "Limpar" não pode cair no X do diálogo.
    await page.keyboard.press("ControlOrMeta+k");
    const busca = page.getByRole("dialog");
    const campo = busca.getByRole("combobox");
    await expect(campo).toBeVisible();
    await campo.fill("x");
    const limpar = busca.getByRole("button", { name: "Limpar", exact: true });
    const caixa = (await limpar.boundingBox())!;
    await page.touchscreen.tap(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await expect(busca, "tocar em Limpar fechou a busca").toBeVisible();
    await expect(campo).toHaveValue("");
    await page.screenshot({ path: path.join(EVIDENCIA, "05-busca-limpa.png") });
  });
});

test.describe("no computador, com o mouse", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false, locale: "pt-BR" });

  test("[P1] controle: o item de menu continua com a altura de sempre", async ({ page }) => {
    mkdirSync(EVIDENCIA, { recursive: true });
    await loginComoAdmin(page, creds);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(false);

    await page.getByRole("button", { name: "Menu do usuário" }).click();
    const sair = page.getByRole("menuitem", { name: "Sair" });
    await expect(sair).toBeVisible();
    // `py-1.5` em volta de `text-sm`: 32 px. Se o `pointer-coarse:` vazar para o
    // mouse, isto vira 44.
    expect((await sair.boundingBox())!.height).toBeLessThan(PISO_DE_TOQUE);
    await page.screenshot({ path: path.join(EVIDENCIA, "06-computador-menu.png") });
    await page.keyboard.press("Escape");
  });
});
