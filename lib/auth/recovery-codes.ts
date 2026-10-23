/**
 * Recovery code generator. Single-use 8-char codes from an ambiguity-free
 * alphabet (no 0/O, 1/I/L). Rejection sampling avoids modulo bias.
 *
 * Stored in `user_recovery_codes.code_hash` (bytea) as the value of
 * `hashRecoveryCode` — the SAME string is written by the actions and used by
 * the login lookup, so both sides cross PostgREST in the same form.
 */
import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars, ambiguity-free
const CODE_LEN = 8;
const CODE_COUNT = 10;

// Reject bytes >= MAX_VALID to avoid modulo bias (256 % 31 != 0).
const MAX_VALID = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

export function generateRecoveryCode(): string {
  let out = "";
  while (out.length < CODE_LEN) {
    const buf = randomBytes(CODE_LEN);
    for (let i = 0; i < buf.length && out.length < CODE_LEN; i++) {
      const b = buf[i];
      if (b !== undefined && b < MAX_VALID) {
        out += ALPHABET[b % ALPHABET.length];
      }
    }
  }
  return out;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: CODE_COUNT }, () => generateRecoveryCode());
}

/** O que a pessoa digita vira o código como foi mostrado: sem espaços nem hífens, em maiúsculas. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Literal `bytea` em hex (`\x` + 64 dígitos): uma string atravessa o corpo JSON
 * do insert e a URL do filtro sem mudar, e o Postgres a lê como os 32 bytes do
 * digest nos dois casos. (Um Buffer não: no JSON ele vira o texto
 * `{"type":"Buffer",...}`, e na URL vira o digest decodificado como UTF-8.)
 *
 * O prefixo versiona o que entra no digest: nenhuma linha gravada antes desta
 * forma casa com ela — códigos antigos precisam ser gerados de novo.
 */
export function hashRecoveryCode(code: string): string {
  const digest = createHash("sha256").update(`recovery-code:v2:${normalizeRecoveryCode(code)}`).digest("hex");
  return `\\x${digest}`;
}
