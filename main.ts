import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Int32Array narrows every result, including unsigned quotients, on assignment.
const binary = {
  0x10: (a, b) => a + b,
  0x11: (a, b) => a - b,
  0x12: Math.imul,
  0x13: (a, b) => a / b,
  0x14: (a, b) => a % b,
  0x15: (a, b) => (a >>> 0) / (b >>> 0),
  0x16: (a, b) => (a >>> 0) % (b >>> 0),
  0x18: (a, b) => a & b,
  0x19: (a, b) => a | b,
  0x1a: (a, b) => a ^ b,
  0x1c: (a, b) => a << b,
  0x1d: (a, b) => a >> b,
  0x1e: (a, b) => a >>> b,
  0x20: (a, b) => Number(a === b),
  0x21: (a, b) => Number(a < b),
  0x22: (a, b) => Number((a >>> 0) < (b >>> 0)),
};

function interpret(code, input, output) {
  const stack = new Int32Array(256);
  const memory = new Int32Array(256);
  const returns = new Uint32Array(64);
  let pc = 0, depth = 0, calls = 0, cursor = 0;

  for (let step = 0; step < 1_000_000; step++) {
    if (pc < 0 || pc >= code.length) return 9;
    const op = code[pc++];
    const calculate = binary[op];
    if (calculate) {
      if (depth < 2) return 2;
      const right = stack[--depth];
      if (op >= 0x13 && op <= 0x16 && right === 0) return 4;
      stack[depth - 1] = calculate(stack[depth - 1], right);
      continue;
    }
    switch (op) {
      case 0x00: return 0;
      case 0x01:
      case 0x02: {
        const width = op === 0x01 ? 1 : 4;
        if (pc + width > code.length) return 9;
        if (depth === stack.length) return 3;
        stack[depth++] = width === 1 ? code.readInt8(pc) : code.readInt32LE(pc);
        pc += width;
        break;
      }
      case 0x03:
        if (!depth) return 2;
        depth--;
        break;
      case 0x04:
      case 0x06: {
        const distance = op === 0x04 ? 1 : 2;
        if (depth < distance) return 2;
        if (depth === stack.length) return 3;
        stack[depth] = stack[depth - distance];
        depth++;
        break;
      }
      // SWAP and ROT both move the deepest operand to the top.
      case 0x05:
      case 0x07: {
        const count = op === 0x05 ? 2 : 3;
        if (depth < count) return 2;
        const first = depth - count;
        const saved = stack[first];
        stack.copyWithin(first, first + 1, depth);
        stack[depth - 1] = saved;
        break;
      }
      case 0x17:
      case 0x1b:
        if (!depth) return 2;
        stack[depth - 1] = op === 0x17 ? -stack[depth - 1] : ~stack[depth - 1];
        break;
      case 0x30:
      case 0x31:
      case 0x32: {
        if (pc + 2 > code.length) return 9;
        const displacement = code.readInt16LE(pc);
        pc += 2;
        if (op === 0x30) {
          pc += displacement;
        } else {
          if (!depth) return 2;
          const isZero = stack[--depth] === 0;
          if (isZero === (op === 0x31)) pc += displacement;
        }
        break;
      }
      case 0x33:
        if (pc + 2 > code.length) return 9;
        if (calls === returns.length) return 7;
        returns[calls++] = pc + 2;
        pc = code.readUInt16LE(pc);
        break;
      case 0x34:
        if (!calls) return 8;
        pc = returns[--calls];
        break;
      case 0x40:
      case 0x41: {
        const store = op === 0x41;
        if (depth < (store ? 2 : 1)) return 2;
        const address = stack[depth - 1];
        if (address < 0 || address >= memory.length) return 6;
        if (store) {
          memory[address] = stack[depth - 2];
          depth -= 2;
        } else {
          stack[depth - 1] = memory[address];
        }
        break;
      }
      case 0x50: {
        if (!depth) return 2;
        const digits = String(stack[--depth]);
        // Reserve the entire decimal string before writing its first byte.
        if (digits.length > output.bytes.length - output.used) return 11;
        output.used += output.bytes.write(digits, output.used, 'ascii');
        break;
      }
      case 0x51:
        if (!depth) return 2;
        if (output.used === output.bytes.length) return 11;
        output.bytes[output.used++] = stack[--depth] & 255;
        break;
      case 0x52:
        if (depth === stack.length) return 3;
        stack[depth++] = cursor < input.length ? input[cursor++] : -1;
        break;
      case 0x53:
        if (!depth) return 2;
        return stack[--depth] & 255;
      default: return 5;
    }
  }
  return 10;
}

const inputRoot = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputRoot = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const bytes = Buffer.alloc(65_536);
for (const id of readdirSync(inputRoot).sort()) {
  const dir = join(inputRoot, id);
  const output = {bytes, used: 0};
  const exit = interpret(readFileSync(join(dir, 'program.bin')), readFileSync(join(dir, 'input.bin')), output);
  const dest = join(outputRoot, id);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'stdout.bin'), bytes.subarray(0, output.used));
  writeFileSync(join(dest, 'exit.txt'), String(exit));
}
