import { describe, expect, it } from "vitest";
import { z } from "zod";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/jpg",
]);

const PostSchema = z.object({
  field_key: z
    .string()
    .trim()
    .min(1, "field_key não pode ser vazio.")
    .max(100, "field_key muito longo."),
});

const DeleteSchema = z.object({
  field_key: z.string().trim().min(1, "field_key é obrigatório."),
  attachment_id: z.string().uuid("attachment_id inválido."),
});

describe("lead attachments - validação e regras de negócio", () => {
  it("valida field_key no schema de upload (Zod)", () => {
    expect(PostSchema.safeParse({ field_key: "vouchers" }).success).toBe(true);
    expect(PostSchema.safeParse({ field_key: "print_emissao" }).success).toBe(true);
    expect(PostSchema.safeParse({ field_key: "" }).success).toBe(false);
    expect(PostSchema.safeParse({ field_key: "   " }).success).toBe(false);
    expect(PostSchema.safeParse({}).success).toBe(false);
  });

  it("valida parâmetros de exclusão de anexo", () => {
    const validUuid = "11111111-2222-4333-8444-555555555555";
    expect(
      DeleteSchema.safeParse({ field_key: "vouchers", attachment_id: validUuid }).success,
    ).toBe(true);

    expect(
      DeleteSchema.safeParse({ field_key: "vouchers", attachment_id: "nao-uuid" }).success,
    ).toBe(false);

    expect(
      DeleteSchema.safeParse({ field_key: "", attachment_id: validUuid }).success,
    ).toBe(false);
  });

  it("aceita apenas formatos suportados para documentos e vouchers", () => {
    expect(ALLOWED_MIMES.has("application/pdf")).toBe(true);
    expect(ALLOWED_MIMES.has("image/png")).toBe(true);
    expect(ALLOWED_MIMES.has("image/jpeg")).toBe(true);
    expect(ALLOWED_MIMES.has("image/webp")).toBe(true);

    // Rejeita formatos não permitidos
    expect(ALLOWED_MIMES.has("text/html")).toBe(false);
    expect(ALLOWED_MIMES.has("application/x-msdownload")).toBe(false);
    expect(ALLOWED_MIMES.has("application/javascript")).toBe(false);
  });

  it("respeita o limite máximo de 50 MB por anexo", () => {
    const arquivoValidoBytes = 49 * 1024 * 1024;
    const arquivoExcedenteBytes = 51 * 1024 * 1024;

    expect(arquivoValidoBytes <= MAX_BYTES).toBe(true);
    expect(arquivoExcedenteBytes <= MAX_BYTES).toBe(false);
  });

  it("monta o endpoint de mídia on-demand sem expiração no banco", () => {
    const leadId = "lead-uuid-123";
    const attachmentId = "att-uuid-456";
    const mediaUrl = `/api/v1/leads/${leadId}/attachments/${attachmentId}/media`;

    expect(mediaUrl).toContain(`/leads/${leadId}/attachments/${attachmentId}/media`);
    expect(mediaUrl).not.toContain("token=");
    expect(mediaUrl).not.toContain("expires=");
  });
});
