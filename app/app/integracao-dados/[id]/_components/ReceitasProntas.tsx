"use client";

import { useId, useMemo, useState } from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

import { previewReceita, salvarReceitas, useReceitasDaConexao } from "@/hooks/external-db/useReceitasDaConexao";
import { randomId } from "@/lib/random-id";
import { ApiError } from "@/lib/api/types";
import { useT } from "@/hooks/i18n/useT";
import {
  DADOS_DE_CAMPO_IMOVEL,
  POST_TYPE_PADRAO,
  POST_TYPE_REGEX,
} from "@/lib/external-db/receitas/acf-imoveis";
import { RECEITAS, receitaDe } from "@/lib/external-db/receitas/registro";
import type { InstanciaDeReceita } from "@/lib/external-db/receitas/tipos";
import type { DefinicaoDeReceita } from "@/lib/external-db/receitas/tipos";

interface Props {
  connectionId: string;
  /** Só mostra para conexão mysql. */
  motor: "mysql" | "postgres";
  /** Só o administrador edita; os demais só leem. */
  canWrite: boolean;
}

const PREFIXO_PADRAO = "wp_";
const PREFIXO_REGEX = /^[A-Za-z0-9_]{1,20}$/;
const BUSCA_PADRAO = { limite: 5 };

/** O rótulo de cada dado do imóvel (campo do site). */
const ROTULO_DO_CAMPO: Record<(typeof DADOS_DE_CAMPO_IMOVEL)[number], string> = {
  codigo: "Código",
  preco: "Preço de venda",
  aluguel: "Aluguel",
  condominio: "Condomínio",
  quartos: "Quartos",
  suites: "Suítes",
  banheiros: "Banheiros",
  vagas: "Vagas",
  area: "Área",
};

/**
 * As quatro categorias que podem ser CATEGORIA (taxonomia) ou CAMPO do site.
 *
 * O `nivel` é o que a receita sabe ler de hierarquia: "filho" = só os termos
 * que têm um termo acima (o bairro, quando a cidade é o pai); "raiz" = só os
 * que não têm (a cidade). `null` = a categoria não tem hierarquia.
 */
const CATEGORIAS_IMOVEL = [
  { chave: "bairro", nivel: "filho" },
  { chave: "cidade", nivel: "raiz" },
  { chave: "tipo", nivel: null },
  { chave: "finalidade", nivel: null },
] as const;

/** O rótulo de cada categoria. */
const ROTULO_DA_CATEGORIA: Record<(typeof CATEGORIAS_IMOVEL)[number]["chave"], string> = {
  bairro: "Bairro",
  cidade: "Cidade",
  tipo: "Tipo",
  finalidade: "Finalidade",
};

/** De onde o dado vem: não se usa, campo do site ou categoria do site. */
type EscolhaDaCategoria = "nao-usar" | "campo" | "categoria";

/**
 * O que a tela está editando do ACF.
 *
 * O editor é a FONTE da verdade enquanto a edição está aberta: os "fixos" que
 * vão para o banco são DERIVADOS dele. Isso resolve o caso em que a pessoa
 * escolhe "categoria" e ainda não digitou o nome — uma chave vazia seria
 * recusada pelo servidor, e o texto meio escrito se perderia a cada tecla.
 */
interface EditorDoAcf {
  /** O texto cru de cada campo mapeado (vazio = não mapeado). */
  campos: Record<string, string>;
  /** A escolha de cada categoria. */
  escolhas: Record<string, EscolhaDaCategoria>;
  /** O texto cru do slug da categoria de cada uma. */
  taxonomias: Record<string, string>;
  /** O nível escolhido de cada categoria com hierarquia. */
  niveis: Record<string, string>;
  /** O campo da situação do imóvel. */
  situacaoCampo: string;
  /** Os valores a esconder, separados por vírgula. */
  situacaoOcultar: string;
}

/** Os valores a esconder, já separados e limpos. */
function valoresOcultos(texto: string): string[] {
  return texto
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, 10);
}

/**
 * Os "fixos" que a tela grava, DERIVADOS do editor.
 *
 * Regras que valem para todo dado: campo apagado = chave removida (nunca
 * vazio, que o servidor recusa); categoria escolhida mas sem nome = ainda não
 * mapeada; e um dado tem UMA fonte (campo OU categoria).
 */
function fixosDoEditor(
  editor: EditorDoAcf,
  prefixo: string,
  postType: string,
): Record<string, unknown> {
  const campos: Record<string, string> = {};

  for (const chave of DADOS_DE_CAMPO_IMOVEL) {
    const valor = (editor.campos[chave] ?? "").trim();
    if (valor.length > 0) campos[chave] = valor;
  }

  const taxonomias: Record<string, { taxonomia: string; nivel?: string }> = {};
  for (const categoria of CATEGORIAS_IMOVEL) {
    const escolha = editor.escolhas[categoria.chave] ?? "nao-usar";
    if (escolha === "campo") {
      const valor = (editor.campos[categoria.chave] ?? "").trim();
      if (valor.length > 0) campos[categoria.chave] = valor;
    } else if (escolha === "categoria") {
      const slug = (editor.taxonomias[categoria.chave] ?? "").trim();
      if (slug.length === 0) continue;
      taxonomias[categoria.chave] = categoria.nivel
        ? { taxonomia: slug, nivel: editor.niveis[categoria.chave] ?? "qualquer" }
        : { taxonomia: slug };
    }
  }

  const fixos: Record<string, unknown> = { prefixo, post_type: postType, campos, taxonomias };

  const campoSituacao = editor.situacaoCampo.trim();
  const ocultar = valoresOcultos(editor.situacaoOcultar);
  if (campoSituacao.length > 0 && ocultar.length > 0) {
    fixos.situacao = { campo: campoSituacao, ocultar };
  }

  return fixos;
}

/** O editor a partir dos "fixos" gravados (o que a pessoa tinha salvo). */
function editorDoAcf(fixos: unknown): EditorDoAcf {
  const f = (fixos ?? {}) as {
    campos?: Record<string, string>;
    taxonomias?: Record<string, { taxonomia?: string; nivel?: string }>;
    situacao?: { campo?: string; ocultar?: string[] };
  };

  const campos: Record<string, string> = {};
  for (const chave of DADOS_DE_CAMPO_IMOVEL) {
    const valor = f.campos?.[chave];
    if (valor) campos[chave] = valor;
  }

  const escolhas: Record<string, EscolhaDaCategoria> = {};
  const taxonomias: Record<string, string> = {};
  const niveis: Record<string, string> = {};
  for (const categoria of CATEGORIAS_IMOVEL) {
    const taxonomia = f.taxonomias?.[categoria.chave];
    if (taxonomia?.taxonomia) {
      escolhas[categoria.chave] = "categoria";
      taxonomias[categoria.chave] = taxonomia.taxonomia;
      niveis[categoria.chave] = taxonomia.nivel ?? "qualquer";
    } else if (f.campos?.[categoria.chave]) {
      escolhas[categoria.chave] = "campo";
      campos[categoria.chave] = f.campos[categoria.chave]!;
    } else {
      escolhas[categoria.chave] = "nao-usar";
    }
  }

  return {
    campos,
    escolhas,
    taxonomias,
    niveis,
    // A situação que NÃO foi salva abre VAZIA. A instância gravada antes do
    // bloco "Esconder imóveis" não tem `situacao` — e abrir o editor com o
    // padrão ("situacao", "vendido, alugado") ligaria um filtro que ninguém
    // pediu, que passaria a valer no salvamento seguinte. O padrão é do
    // editor de instância NOVA (`editorPadraoAcf`).
    situacaoCampo: f.situacao?.campo ?? "",
    situacaoOcultar: (f.situacao?.ocultar ?? []).join(", "),
  };
}

/** O editor de uma instância nova: o mínimo que já serve. */
function editorPadraoAcf(): EditorDoAcf {
  return {
    campos: { preco: "preco", quartos: "quartos" },
    escolhas: {
      bairro: "nao-usar",
      cidade: "nao-usar",
      tipo: "nao-usar",
      finalidade: "nao-usar",
    },
    taxonomias: {},
    niveis: { bairro: "qualquer", cidade: "qualquer" },
    situacaoCampo: "situacao",
    situacaoOcultar: "vendido, alugado",
  };
}

/** A regex do `meta_key`: mesma da receita (`acf-imoveis.ts`), aqui para o campo da tela. */
const META_KEY_REGEX = /^[A-Za-z0-9_\-]{1,64}$/;

/** A regex do slug da taxonomia: mesma da receita, aqui para o campo da tela. */
const TAXONOMIA_REGEX = /^[a-z0-9_-]{1,32}$/;

function receitasDisponiveis(motor: "mysql" | "postgres"): DefinicaoDeReceita[] {
  return [...RECEITAS.values()].filter((r) => r.motores.includes(motor));
}

export default function ReceitasProntas({ connectionId, motor, canWrite }: Props) {
  const t = useT();
  const query = useReceitasDaConexao(connectionId);
  const idInputRotulo = useId();
  const idInputDescricao = useId();
  const idInputPrefixo = useId();
  const idInputPostType = useId();
  const idInputAcf = useId();

  // Uma linha em edição (rascunho local, ainda não salvo). A lista completa
  // sempre deriva do servidor (query.data) + o rascunho em edição, então
  // acompanha o servidor após cada refetch sem setState síncrono em efeito.
  const [rascunho, setRascunho] = useState<InstanciaDeReceita | null>(null);
  // O que a tela está editando do ACF (a fonte da verdade dos "fixos" em edição).
  const [editorAcf, setEditorAcf] = useState<EditorDoAcf | null>(null);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    instancia: { id: string; receita: string; rotulo: string };
    colunas: string[];
    linhas: Record<string, unknown>[];
    linhas_devolvidas: number;
    truncado?: boolean;
  } | null>(null);
  const [previewando, setPreviewando] = useState(false);

  const lista = useMemo(() => {
    const base = [...(query.data?.receitas ?? [])];
    if (rascunho) {
      const idx = base.findIndex((i) => i.id === rascunho.id);
      if (idx >= 0) base[idx] = rascunho;
      else base.push(rascunho);
    }
    return base;
  }, [query.data, rascunho]);

  const receitas = lista;
  const jaCadastradas = new Set(receitas.map((r) => r.receita));
  const opcoes = receitasDisponiveis(motor).filter((r) => !jaCadastradas.has(r.id));

  const salvar = async () => {
    if (!canWrite) return;
    try {
      await salvarReceitas(connectionId, lista);
      toast.success(t("Salvo."));
      setRascunho(null);
      setEditorAcf(null);
      await query.refetch();
    } catch (err) {
      // 422 de validação do Zod: a rota devolve `details.fieldErrors` com o
      // campo que falhou. Mostra qual campo e por quê, em vez do genérico
      // "Campos inválidos."
      if (err instanceof ApiError && err.code === "validation_failed") {
        const fieldErrors = (err.details as
          | { fieldErrors?: Record<string, string[]> }
          | undefined)?.fieldErrors;
        const campo = fieldErrors ? Object.keys(fieldErrors)[0] : undefined;
        const motivo = fieldErrors && campo ? fieldErrors[campo]?.[0] : undefined;
        if (fieldErrors && campo) {
          // O rótulo do campo que falhou, em português de leigo: o Zod da
          // receita responde por "campos", "taxonomias", "bairro"…
          const rotuloDoCampo: Record<string, string> = {
            descricao: t("Descrição"),
            rotulo: t("Rótulo"),
            campos: t("Campos do imóvel"),
            taxonomias: t("Categorias"),
            situacao: t("Esconder imóveis"),
            prefixo: t("Prefixo das tabelas"),
            post_type: t("Tipo de post"),
            bairro: t("Bairro"),
            cidade: t("Cidade"),
            tipo: t("Tipo"),
            finalidade: t("Finalidade"),
          };
          const label = rotuloDoCampo[campo] ?? campo;
          toast.error(
            t("O campo {campo} não pôde ser salvo: {motivo}")
              .replace("{campo}", label)
              .replace("{motivo}", t(motivo ?? "")),
          );
          return;
        }
      }
      showApiError(err);
    }
  };

  const adicionar = () => {
    if (!canWrite) return;
    const primeira = opcoes[0];
    if (!primeira) return;
    const receita = receitaDe(primeira.id);
    const ehAcf = primeira.id === "acf-imoveis";
    const editor = ehAcf ? editorPadraoAcf() : null;
    setEditorAcf(editor);
    const nova: InstanciaDeReceita = {
      id: randomId(),
      receita: primeira.id,
      rotulo: receita?.rotulo ?? primeira.id,
      descricao: "",
      // A receita `acf-imoveis` precisa de prefixo + tipo de post + o mapeamento
      // de onde vem cada dado: sem os fixos certos, o SQL montado não acha as
      // tabelas.
      fixos: ehAcf
        ? fixosDoEditor(editor!, PREFIXO_PADRAO, POST_TYPE_PADRAO)
        : { prefixo: PREFIXO_PADRAO },
      ativa: true,
    };
    setRascunho(nova);
  };

  const editar = (inst: InstanciaDeReceita) => {
    if (!canWrite) return;
    setEditorAcf(inst.receita === "acf-imoveis" ? editorDoAcf(inst.fixos) : null);
    setRascunho(inst);
  };

  /** Troca um campo do editor e recalcula os "fixos" que vão para o banco. */
  const mudarEditor = (novo: EditorDoAcf) => {
    setEditorAcf(novo);
    if (!rascunho) return;
    const f = (rascunho.fixos ?? {}) as { prefixo?: string; post_type?: string };
    const prox = {
      ...rascunho,
      fixos: fixosDoEditor(novo, f.prefixo ?? PREFIXO_PADRAO, f.post_type ?? POST_TYPE_PADRAO),
    };
    setRascunho(prox);
  };

  const remover = async (id: string) => {
    if (!canWrite) return;
    setConfirmandoRemocao(id);
  };

  const confirmarRemocao = async () => {
    if (!confirmandoRemocao) return;
    const prox = lista.filter((i) => i.id !== confirmandoRemocao);
    setConfirmandoRemocao(null);
    try {
      await salvarReceitas(connectionId, prox);
      await query.refetch();
    } catch (err) {
      showApiError(err);
    }
  };

  const cancelarRemocao = () => {
    setConfirmandoRemocao(null);
  };

  const executarPreview = async (inst: InstanciaDeReceita) => {
    if (!canWrite) return;
    setPreviewando(true);
    try {
      const resultado = await previewReceita(connectionId, inst.id, BUSCA_PADRAO);
      setPreview(resultado);
    } catch (err) {
      showApiError(err);
      setPreview(null);
    } finally {
      setPreviewando(false);
    }
  };

  if (motor !== "mysql") return null;
  if (opcoes.length === 0 && receitas.length === 0) return null;

  // Query falhou: nunca fica em silêncio (Living System, item 1). Mostra mensagem
  // legível com botão para tentar de novo.
  if (query.isError) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("Não foi possível carregar as receitas.")}{" "}
        <Button size="sm" onClick={() => query.refetch()}>
          {t("Tentar de novo")}
        </Button>
      </div>
    );
  }

  return (
    <Card className="border border-border">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm font-semibold">{t("Receitas prontas")}</CardTitle>
        {canWrite && opcoes.length > 0 && (
          <Button size="sm" onClick={adicionar}>
            {t("Adicionar receita")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!query.data && <p className="text-sm text-muted-foreground">{t("Carregando receitas…")}</p>}
        {query.data && receitas.length === 0 && canWrite && (
          <p className="text-sm text-muted-foreground">
            {t("Nenhuma receita cadastrada ainda. Adicione uma para o assistente consultar o banco de origem.")}
          </p>
        )}

        {receitas.map((inst) => {
          const receita = receitaDe(inst.receita);
          const editandoEsta = rascunho?.id === inst.id;
          const ehAcf = receita?.id === "acf-imoveis";
          const cols =
            inst.fixos && typeof inst.fixos === "object" && "prefixo" in inst.fixos
              ? String((inst.fixos as { prefixo?: string }).prefixo ?? PREFIXO_PADRAO)
              : PREFIXO_PADRAO;
          // Os fixos do ACF: tipo de post e o mapeamento de meta_key por campo.
          const fixosAcf: { post_type?: string } = (inst.fixos as
            | { post_type?: string }
            | undefined) ?? {};
          const postType = fixosAcf.post_type ?? POST_TYPE_PADRAO;
          // O editor é a fonte da verdade dos campos em edição; quando ele não
          // está na mão (ex.: recarregou a tela no meio da edição), ele é
          // reconstruído a partir dos "fixos" salvos — um formulário vazio
          // faria a pessoa salvar o mapeamento apagado sem querer.
          const editor =
            editandoEsta && ehAcf ? (editorAcf ?? editorDoAcf(inst.fixos)) : null;

          if (editandoEsta && canWrite) {
            return (
              <Card key={inst.id} className="border border-border p-3 mb-2">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="col-span-1 md:col-span-2">
                    <Label htmlFor={idInputRotulo} className="text-xs text-muted-foreground">
                      {t("Rótulo")}
                    </Label>
                    <Input
                      id={idInputRotulo}
                      maxLength={80}
                      value={inst.rotulo}
                      onChange={(e) => {
                        const prox = { ...inst, rotulo: e.target.value };
                        setRascunho(prox);
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor={idInputDescricao} className="text-xs text-muted-foreground">
                      {t("Descrição")}
                    </Label>
                    <Input
                      id={idInputDescricao}
                      maxLength={300}
                      value={inst.descricao}
                      onChange={(e) => {
                        const prox = { ...inst, descricao: e.target.value };
                        setRascunho(prox);
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor={idInputPrefixo} className="text-xs text-muted-foreground">
                      {t("Prefixo das tabelas")}
                    </Label>
                    <Input
                      id={idInputPrefixo}
                      value={cols}
                      onChange={(e) => {
                        const valor = e.target.value;
                        if (!PREFIXO_REGEX.test(valor)) return;
                        const prox = { ...inst, fixos: { ...(inst.fixos as object), prefixo: valor } };
                        setRascunho(prox);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("O prefixo aparece antes de _posts no banco do WordPress (padrão wp_).")}
                    </p>
                  </div>
                  {ehAcf && (
                    <div>
                      <Label htmlFor={idInputPostType} className="text-xs text-muted-foreground">
                        {t("Tipo de post")}
                      </Label>
                      <Input
                        id={idInputPostType}
                        value={postType}
                        onChange={(e) => {
                          const valor = e.target.value;
                          if (!POST_TYPE_REGEX.test(valor)) return;
                          const prox = {
                            ...inst,
                            fixos: { ...(inst.fixos as object), post_type: valor },
                          };
                          setRascunho(prox);
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("Qual tipo de post do WordPress (padrão imovel).")}
                      </p>
                    </div>
                  )}
                  <div className="col-span-1 md:col-span-1 flex items-end">
                    <Switch
                      checked={inst.ativa}
                      onCheckedChange={(ativa) => {
                        const prox = { ...inst, ativa };
                        setRascunho(prox);
                      }}
                    />
                    <Label className="text-xs ml-2 text-muted-foreground">{t("Ativa")}</Label>
                  </div>
                </div>
                {ehAcf && editor && (
                  <div className="mt-2 space-y-4 border-t pt-3">
                    {/* ── Campos do imóvel ───────────────────────────────────── */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        {t("Campos do imóvel")}
                      </p>
                      <p className="text-xs text-muted-foreground mb-2">
                        {t("O nome do campo no ACF ou no JetEngine. Deixe vazio o que o site não usa.")}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {DADOS_DE_CAMPO_IMOVEL.map((chave) => {
                          const idCampo = `${idInputAcf}-campo-${chave}`;
                          return (
                            <div key={chave}>
                              <Label htmlFor={idCampo} className="text-xs text-muted-foreground">
                                {t(ROTULO_DO_CAMPO[chave])}
                              </Label>
                              <Input
                                id={idCampo}
                                value={editor.campos[chave] ?? ""}
                                onChange={(e) => {
                                  const valor = e.target.value;
                                  if (valor !== "" && !META_KEY_REGEX.test(valor)) return;
                                  mudarEditor({
                                    ...editor,
                                    campos: { ...editor.campos, [chave]: valor },
                                  });
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Categorias ──────────────────────────────────────────── */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">{t("Categorias")}</p>
                      <p className="text-xs text-muted-foreground mb-2">
                        {t("Bairro, cidade, tipo e finalidade podem estar no site como categoria ou como campo.")}
                      </p>
                      <div className="space-y-3">
                        {CATEGORIAS_IMOVEL.map((categoria) => {
                          const idFonte = `${idInputAcf}-${categoria.chave}-fonte`;
                          const idValor = `${idInputAcf}-${categoria.chave}-valor`;
                          const idNivel = `${idInputAcf}-${categoria.chave}-nivel`;
                          const escolha = editor.escolhas[categoria.chave] ?? "nao-usar";
                          return (
                            <div
                              key={categoria.chave}
                              className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                            >
                              <div>
                                <Label
                                  htmlFor={idFonte}
                                  className="text-xs text-muted-foreground"
                                >
                                  {t(ROTULO_DA_CATEGORIA[categoria.chave])}
                                </Label>
                                <select
                                  id={idFonte}
                                  value={escolha}
                                  onChange={(e) => {
                                    const nova = e.target.value as EscolhaDaCategoria;
                                    const campos = { ...editor.campos };
                                    const taxonomias = { ...editor.taxonomias };
                                    // Trocar de fonte limpa o texto da outra:
                                    // o que ficou para trás não pode voltar.
                                    if (nova === "campo") delete taxonomias[categoria.chave];
                                    if (nova === "categoria") delete campos[categoria.chave];
                                    if (nova === "nao-usar") {
                                      delete taxonomias[categoria.chave];
                                      delete campos[categoria.chave];
                                    }
                                    mudarEditor({
                                      ...editor,
                                      campos,
                                      taxonomias,
                                      escolhas: { ...editor.escolhas, [categoria.chave]: nova },
                                    });
                                  }}
                                  className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
                                >
                                  <option value="nao-usar">{t("Não usar")}</option>
                                  <option value="campo">{t("Campo")}</option>
                                  <option value="categoria">{t("Categoria")}</option>
                                </select>
                              </div>

                              {escolha === "campo" && (
                                <div>
                                  <Label htmlFor={idValor} className="text-xs text-muted-foreground">
                                    {t("Nome do campo")}
                                  </Label>
                                  <Input
                                    id={idValor}
                                    value={editor.campos[categoria.chave] ?? ""}
                                    onChange={(e) => {
                                      const valor = e.target.value;
                                      if (valor !== "" && !META_KEY_REGEX.test(valor)) return;
                                      mudarEditor({
                                        ...editor,
                                        campos: { ...editor.campos, [categoria.chave]: valor },
                                      });
                                    }}
                                  />
                                </div>
                              )}

                              {escolha === "categoria" && (
                                <div>
                                  <Label htmlFor={idValor} className="text-xs text-muted-foreground">
                                    {t("Nome da categoria")}
                                  </Label>
                                  <Input
                                    id={idValor}
                                    value={editor.taxonomias[categoria.chave] ?? ""}
                                    onChange={(e) => {
                                      const valor = e.target.value;
                                      if (valor !== "" && !TAXONOMIA_REGEX.test(valor)) return;
                                      mudarEditor({
                                        ...editor,
                                        taxonomias: {
                                          ...editor.taxonomias,
                                          [categoria.chave]: valor,
                                        },
                                      });
                                    }}
                                  />
                                </div>
                              )}

                              {escolha === "categoria" && categoria.nivel && (
                                <div>
                                  <Label htmlFor={idNivel} className="text-xs text-muted-foreground">
                                    {t("Nível")}
                                  </Label>
                                  <select
                                    id={idNivel}
                                    value={editor.niveis[categoria.chave] ?? "qualquer"}
                                    onChange={(e) => {
                                      mudarEditor({
                                        ...editor,
                                        niveis: {
                                          ...editor.niveis,
                                          [categoria.chave]: e.target.value,
                                        },
                                      });
                                    }}
                                    className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
                                  >
                                    <option value="qualquer">{t("Qualquer")}</option>
                                    {categoria.nivel === "filho" && (
                                      <option value="filho">{t("Só o bairro (tem cidade acima)")}</option>
                                    )}
                                    {categoria.nivel === "raiz" && (
                                      <option value="raiz">{t("Só a cidade (não tem cidade acima)")}</option>
                                    )}
                                  </select>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Esconder imóveis ────────────────────────────────────── */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        {t("Esconder imóveis")}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <Label
                            htmlFor={`${idInputAcf}-situacao-campo`}
                            className="text-xs text-muted-foreground"
                          >
                            {t("Campo da situação")}
                          </Label>
                          <Input
                            id={`${idInputAcf}-situacao-campo`}
                            value={editor.situacaoCampo}
                            onChange={(e) => {
                              const valor = e.target.value;
                              if (valor !== "" && !META_KEY_REGEX.test(valor)) return;
                              mudarEditor({ ...editor, situacaoCampo: valor });
                            }}
                          />
                        </div>
                        <div>
                          <Label
                            htmlFor={`${idInputAcf}-situacao-ocultar`}
                            className="text-xs text-muted-foreground"
                          >
                            {t("Valores a esconder")}
                          </Label>
                          <Input
                            id={`${idInputAcf}-situacao-ocultar`}
                            value={editor.situacaoOcultar}
                            onChange={(e) => {
                              mudarEditor({ ...editor, situacaoOcultar: e.target.value });
                            }}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("Imóvel com um desses valores na situação não aparece para o cliente.")}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 mt-2">
                  <Button size="sm" onClick={salvar}>
                    {t("Salvar")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    setRascunho(null);
                    setEditorAcf(null);
                  }}>
                    {t("Cancelar")}
                  </Button>
                  <Button size="sm" onClick={() => executarPreview(inst)} disabled={previewando}>
                    {previewando ? t("Pré-visualizando…") : t("Pré-visualizar")}
                  </Button>
                  {canWrite && (
                    <>
                      {confirmandoRemocao === inst.id ? (
                        <>
                          <Button size="sm" variant="outline" onClick={confirmarRemocao}>
                            {t("Sim")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelarRemocao}>
                            {t("Não")}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => remover(inst.id)}>
                          {t("Remover")}
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {preview && preview.instancia.id === inst.id && (
                  <div className="mt-3 border-t pt-2">
                    <p className="text-xs text-muted-foreground mb-1">
                      {t("Pré-visualização (até 5 linhas)")} — {preview.linhas_devolvidas} {preview.linhas_devolvidas === 1 ? t("linha") : t("linhas")}
                      {preview.truncado ? ` · ${t("truncado")}` : ""}
                    </p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {preview.colunas.map((c) => (
                              <TableCell key={c} className="text-xs font-medium">{c}</TableCell>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.linhas.map((linha, i) => (
                            <TableRow key={i}>
                              {preview.colunas.map((c) => (
                                <TableCell key={c} className="text-xs">
                                  {String(linha[c] ?? "")}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </Card>
            );
          }

          return (
            <Card key={inst.id} className="border border-border p-3 mb-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{inst.rotulo || (receita?.rotulo ?? inst.receita)}</p>
                  <p className="text-xs text-muted-foreground min-w-0 break-words">{inst.descricao || (receita?.descricao ?? "")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("Prefixo:")} <span className="font-mono">{cols}</span>
                  </p>
                  {ehAcf && (
                    <p className="text-xs text-muted-foreground">
                      {t("Tipo de post:")} <span className="font-mono">{postType}</span>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant={inst.ativa ? "success" : "secondary"}>
                    {inst.ativa ? t("Ativa") : t("Inativa")}
                  </Badge>
                  {canWrite && (
                    <Button size="sm" variant="outline" onClick={() => editar(inst)}>
                      {t("Editar")}
                    </Button>
                  )}
                  {canWrite && (
                    <Button size="sm" onClick={() => executarPreview(inst)} disabled={previewando}>
                      {previewando ? t("Pré-visualizando…") : t("Pré-visualizar")}
                    </Button>
                  )}
                  {canWrite && (
                    <>
                      {confirmandoRemocao === inst.id ? (
                        <>
                          <Button size="sm" variant="outline" onClick={confirmarRemocao}>
                            {t("Sim")}
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelarRemocao}>
                            {t("Não")}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => remover(inst.id)}>
                          {t("Remover")}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {preview && preview.instancia.id === inst.id && (
                <div className="mt-3 border-t pt-2">
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("Pré-visualização (até 5 linhas)")} — {preview.linhas_devolvidas} {preview.linhas_devolvidas === 1 ? t("linha") : t("linhas")}
                    {preview.truncado ? ` · ${t("truncado")}` : ""}
                  </p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {preview.colunas.map((c) => (
                            <TableCell key={c} className="text-xs font-medium">{c}</TableCell>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.linhas.map((linha, i) => (
                          <TableRow key={i}>
                            {preview.colunas.map((c) => (
                              <TableCell key={c} className="text-xs">
                                {String(linha[c] ?? "")}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}
