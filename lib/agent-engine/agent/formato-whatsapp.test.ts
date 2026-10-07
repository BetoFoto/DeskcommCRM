import { describe, expect, it } from "vitest";

import { formatarParaWhatsApp } from "@/lib/agent-engine/agent/formato-whatsapp";

describe("formatarParaWhatsApp", () => {
  it("troca o \\n literal por salto de linha de verdade (caso medido)", () => {
    expect(
      formatarParaWhatsApp("¡Claro, Ana Claudia! 😊 Tómate tu tiempo.\\n\\nCualquier duda, aquí estoy."),
    ).toBe("¡Claro, Ana Claudia! 😊 Tómate tu tiempo.\n\nCualquier duda, aquí estoy.");
  });

  it("converte negrito de Markdown para o do WhatsApp", () => {
    expect(formatarParaWhatsApp("✨ **Endolifting de papada**: desde S/ 1,100")).toBe(
      "✨ *Endolifting de papada*: desde S/ 1,100",
    );
  });

  it("título de Markdown vira negrito", () => {
    expect(formatarParaWhatsApp("## Nuestros servicios\nEndolifting")).toBe(
      "*Nuestros servicios*\nEndolifting",
    );
  });

  it("não mexe no negrito que já está no formato do WhatsApp", () => {
    expect(formatarParaWhatsApp("El *endolifting* usa láser")).toBe("El *endolifting* usa láser");
  });

  it("junta linhas em branco em excesso e apara as pontas", () => {
    expect(formatarParaWhatsApp("  Hola 😊 \n\n\n\n¿En qué te ayudo?  ")).toBe("Hola 😊\n\n¿En qué te ayudo?");
  });
});
