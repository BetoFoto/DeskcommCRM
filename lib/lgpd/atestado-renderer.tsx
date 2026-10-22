/**
 * O PDF do atestado de anonimização.
 *
 * ─── ESTE DOCUMENTO NÃO LEVA MARCA — é decisão, não esquecimento ────────────
 *
 * Mesma régua do relatório do art. 18, II (`lib/lgpd/pdf-renderer.tsx`): o
 * papel imprime o CONTROLADOR e o encarregado; não imprime a marca de quem
 * licenciou o software, não leva logo e não leva cor. Quem responde pelos dados
 * é quem executou o apagamento, e nomear o revendedor (operador) num documento
 * jurídico inverteria os papéis.
 *
 * Consequência prática: `Stylesheet` de módulo, sem `oklch()`/`var(--x)` — que o
 * @react-pdf descarta em silêncio, gerando PDF válido com a cor perdida.
 *
 * O CONTEÚDO vem pronto de `atestado-de-anonimizacao.ts` (declaração, campos e
 * código): este arquivo só desenha. É o que permite testar o texto sem abrir
 * PDF, e o PDF sem redigitar texto.
 */
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

import {
  VERSAO_DO_ATESTADO,
  textoDaDeclaracao,
  type AlgoritmoDoCodigo,
  type DadosDoAtestado,
} from "@/lib/lgpd/atestado-de-anonimizacao";

export interface PropsDoAtestado {
  dados: DadosDoAtestado;
  /** O código já calculado (16 hex citáveis) e o que de fato o produziu. */
  codigo: string;
  algoritmo: AlgoritmoDoCodigo;
}

const styles = StyleSheet.create({
  page: { paddingVertical: 44, paddingHorizontal: 44, fontSize: 9.5, fontFamily: "Helvetica", color: "#111111" },
  header: { borderBottomWidth: 1, borderBottomColor: "#111111", paddingBottom: 10, marginBottom: 14 },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subtitle: { fontSize: 8.5, color: "#444444" },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 5, textTransform: "uppercase" },
  row: { flexDirection: "row", marginBottom: 2.5 },
  label: { width: 132, color: "#444444" },
  value: { flex: 1 },
  declaracao: { lineHeight: 1.5, textAlign: "justify" },
  destaque: { fontFamily: "Helvetica-Bold" },
  caixa: { borderWidth: 1, borderColor: "#111111", padding: 8, marginTop: 4 },
  caixaTitulo: { fontSize: 8, color: "#444444", marginBottom: 3, textTransform: "uppercase" },
  codigo: { fontSize: 13, fontFamily: "Courier-Bold", letterSpacing: 1, marginBottom: 3 },
  notaFina: { fontSize: 7.5, color: "#444444", lineHeight: 1.35 },
  footer: { position: "absolute", bottom: 22, left: 44, right: 44, fontSize: 7, color: "#666666" },
});

/**
 * O documento do titular como o papel o declara.
 *
 * As três linhas saem INLINE no documento (e não de um subcomponente) de
 * propósito: quem lê o texto do PDF é a travessia da árvore de elementos
 * (`textos`, em `art-15-entregue-no-pdf` e no teste deste documento), e ela
 * atravessa elementos de HOST — um `<LinhaDoTitular />` some da travessia, e o
 * documento apareceria sem o requerente para quem o lê por ali.
 */
function documentoDoTitularParaImprimir(dados: DadosDoAtestado): string {
  const t = dados.titular;
  if (t.documento) return `${t.rotuloDoDocumento} ${t.documento}`;
  if (t.documentoNoCadastro) {
    return `${t.rotuloDoDocumento} informado no cadastro (não reimpresso neste documento)`;
  }
  return "não informado no pedido";
}

export function AtestadoDeAnonimizacaoPdf({ dados, codigo, algoritmo }: PropsDoAtestado): React.ReactElement {
  const e = dados.evidencia;
  const executor = e.executor
    ? `${e.executor.nome}${e.executor.papel ? ` — ${e.executor.papel}` : ""}${e.executor.email ? ` <${e.executor.email}>` : ""}`
    : "execução automática do sistema";
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Atestado de Anonimização de Dados Pessoais</Text>
          <Text style={styles.subtitle}>
            {`${dados.lei_rotulo ?? "Base legal"}: ${dados.lei_citada ?? "não declarada (país sem citação revisada)"} · Protocolo #${dados.request_id.slice(0, 8)}`}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Controlador</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Razão social:</Text>
            <Text style={styles.value}>{dados.organization_name}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>CNPJ:</Text>
            <Text style={styles.value}>{dados.organization_document ?? "não cadastrado"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Encarregado (DPO):</Text>
            <Text style={styles.value}>{dados.organization_email ?? "não cadastrado"}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Requerente</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Nome / razão social:</Text>
            <Text style={styles.value}>{dados.titular.nome}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Documento:</Text>
            <Text style={styles.value}>{documentoDoTitularParaImprimir(dados)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>E-mail / telefone:</Text>
            <Text style={styles.value}>
              {[dados.titular.email, dados.titular.telefone].filter(Boolean).join(" · ") || "não informados"}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Declaração</Text>
          <Text style={styles.declaracao}>{textoDaDeclaracao(dados)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Execução</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Data e hora:</Text>
            <Text style={styles.value}>{`${e.em} (${dados.fuso})`}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Executado por:</Text>
            <Text style={styles.value}>{executor}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>IP de origem:</Text>
            <Text style={styles.value}>{e.ip ?? "sem ato humano (execução automática)"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Origem do pedido:</Text>
            <Text style={styles.value}>{e.origem === "aprovacao_manual" ? "aprovação no painel" : "automática"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Escopo:</Text>
            <Text style={styles.value}>
              {dados.escopo === "tenant" ? "base completa da organização" : "dados do titular"}
            </Text>
          </View>
        </View>

        <View style={styles.caixa}>
          <Text style={styles.caixaTitulo}>
            {algoritmo === "hmac-sha256"
              ? "Código de autenticidade (HMAC-SHA256)"
              : "Código de integridade (SHA-256 — instalação sem chave de assinatura)"}
          </Text>
          <Text style={styles.codigo}>{codigo}</Text>
          <Text style={styles.notaFina}>
            {algoritmo === "hmac-sha256"
              ? "Produzido com a chave de assinatura desta instalação sobre os campos declarados neste documento: só quem tem a chave reproduz o código, e qualquer edição em qualquer campo o invalida."
              : "Esta instalação não tem chave de assinatura configurada: o código prova que os campos declarados não foram editados, mas não prova a origem do documento."}
            {` Formato ${VERSAO_DO_ATESTADO}. O código é citável e reconferível pelo controlador.`}
          </Text>
        </View>

        <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) =>
          `Documento gerado automaticamente pelo sistema do controlador · página ${pageNumber} de ${totalPages}`
        } />
      </Page>
    </Document>
  );
}

export async function renderAtestadoPdf(props: PropsDoAtestado): Promise<Buffer> {
  const element = <AtestadoDeAnonimizacaoPdf {...props} />;
  return (await renderToBuffer(element)) as Buffer;
}
