// Tiny stack VM: an interpreter for make.fun's tiny stack ISA (v1). Each
// /input/<id>/program.bin runs on its input.bin; the answers land in
// /output/<id>/stdout.bin and /output/<id>/exit.txt.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode byte -> [immediate bytes, pops, pushes]; binary ops share [0, 2, 1].
const SHAPE: { [op: number]: [number, number, number] } = {
  0: [0, 0, 0], 1: [1, 0, 1], 2: [4, 0, 1], 3: [0, 1, 0], 4: [0, 1, 2], 5: [0, 2, 2], 6: [0, 2, 3], 7: [0, 3, 3],
  23: [0, 1, 1], 27: [0, 1, 1], 48: [2, 0, 0], 49: [2, 1, 0], 50: [2, 1, 0], 51: [2, 0, 0], 52: [0, 0, 0],
  64: [0, 1, 1], 65: [0, 2, 0], 80: [0, 1, 0], 81: [0, 1, 0], 82: [0, 0, 1], 83: [0, 1, 0],
};
for (const op of [16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 28, 29, 30, 32, 33, 34]) SHAPE[op] = [0, 2, 1];

// Runs one program; a trap's code is its exit code, prior output kept.
function run(p: Uint8Array, inp: Uint8Array): { bytes: Uint8Array; code: number } {
  const S = new Int32Array(256), R = new Int32Array(64), M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, rsp = 0, olen = 0, ipos = 0, pc = 0, steps = 0;
  const finish = (code: number) => ({ bytes: out.slice(0, olen), code });
  for (;;) {
    // Step order: step limit, pc range, opcode, immediate, stack needs, effect.
    if (steps === 1000000) return finish(10);
    if (pc < 0 || pc >= p.length) return finish(9);
    const op = p[pc], shape = SHAPE[op];
    if (shape === undefined) return finish(5);
    const [imm, pops, pushes] = shape;
    if (pc + imm >= p.length) return finish(9);
    steps++;
    const next = pc + 1 + imm;
    if (sp < pops) return finish(2);
    if (sp - pops + pushes > 256) return finish(3);
    pc = next;
    switch (op) {
      case 0: return finish(0); // HALT
      case 1: S[sp++] = (p[next - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 2: // PUSH32, little-endian
        S[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24);
        break;
      case 3: sp--; break; // POP
      case 4: S[sp] = S[sp - 1]; sp++; break; // DUP
      case 5: { const t = S[sp - 1]; S[sp - 1] = S[sp - 2]; S[sp - 2] = t; break; } // SWAP
      case 6: S[sp] = S[sp - 2]; sp++; break; // OVER
      case 7: { const a = S[sp - 3]; S[sp - 3] = S[sp - 2]; S[sp - 2] = S[sp - 1]; S[sp - 1] = a; break; } // ROT
      case 23: S[sp - 1] = -S[sp - 1] | 0; break; // NEG
      case 27: S[sp - 1] = ~S[sp - 1]; break; // NOT
      case 48: case 49: case 50: { // JMP / JZ / JNZ, signed offset from next
        const off = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        let go = op === 48;
        if (op !== 48) { const v = S[--sp]; go = op === 49 ? v === 0 : v !== 0; }
        if (go) pc = next + off;
        break;
      }
      case 51: // CALL, the immediate is the absolute target
        if (rsp === 64) return finish(7);
        R[rsp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8);
        break;
      case 52: if (rsp === 0) return finish(8); pc = R[--rsp]; break; // RET
      case 64: { const a = S[sp - 1]; if (a < 0 || a > 255) return finish(6); S[sp - 1] = M[a]; break; } // LOAD
      case 65: { const a = S[sp - 1]; if (a < 0 || a > 255) return finish(6); M[a] = S[sp - 2]; sp -= 2; break; } // STORE
      case 80: { // PRINT, decimal ASCII, written digit by digit into out
        const v = S[--sp], neg = v < 0;
        let x = neg ? -v : v, len = neg ? 1 : 0;
        for (let t = x; ; t = Math.floor(t / 10)) { len++; if (t < 10) break; }
        if (olen + len > 65536) return finish(11);
        let at = olen + len;
        for (let t = x; ; t = Math.floor(t / 10)) { out[--at] = 48 + t % 10; if (t < 10) break; }
        if (neg) out[olen] = 45;
        olen += len;
        break;
      }
      case 81: // PUTC, the low byte
        if (olen + 1 > 65536) return finish(11);
        out[olen++] = S[--sp] & 255;
        break;
      case 82: S[sp++] = ipos < inp.length ? inp[ipos++] : -1; break; // IN, -1 past the end
      case 83: return finish(S[--sp] & 255); // EXIT, the low byte
      default: { // binary operators: ( a b -- r ), b on top
        const b = S[sp - 1], a = S[sp - 2];
        let r: number;
        if (op === 16) r = (a + b) | 0;
        else if (op === 17) r = (a - b) | 0;
        else if (op === 18) r = Math.imul(a, b); // MUL, exact low 32 bits
        else if (op === 19) { // DIV, truncated toward zero
          if (b === 0) return finish(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 20) { // MOD, the dividend's sign
          if (b === 0) return finish(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 21) { // DIVU
          if (b === 0) return finish(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 22) { // MODU
          if (b === 0) return finish(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        }
        else if (op === 24) r = a & b;
        else if (op === 25) r = a | b;
        else if (op === 26) r = a ^ b;
        else if (op === 28) r = a << (b & 31); // SHL, count's low 5 bits
        else if (op === 29) r = a >> (b & 31); // SHR, arithmetic
        else if (op === 30) r = (a >>> (b & 31)) | 0; // SHRU, logical
        else if (op === 32) r = a === b ? 1 : 0;
        else if (op === 33) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU
        S[sp - 2] = r; sp--;
        break;
      }
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input', O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const { bytes, code } = run(readFileSync(join(I, id, 'program.bin')), readFileSync(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), bytes);
  writeFileSync(join(O, id, 'exit.txt'), code + '\n');
}
