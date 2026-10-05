import { describe, expect, it } from "vitest";

import { linkDePagamentoSeguro } from "./link";

describe("linkDePagamentoSeguro — link vindo do banco só vira href se for https", () => {
  it.each([
    ["javascript:", "javascript:alert(1)", null],
    ["http:", "http://pague.example.com/x", null],
    ["data:", "data:text/html,<script>1</script>", null],
    ["texto solto", "isto não é url", null],
    ["vazio", "", null],
    ["nulo", null, null],
    ["⭐ https válido", "https://invoice.example.com/i/x", "https://invoice.example.com/i/x"],
  ] as const)("%s", (_caso, entrada, esperado) => {
    expect(linkDePagamentoSeguro(entrada)).toBe(esperado);
  });
});
