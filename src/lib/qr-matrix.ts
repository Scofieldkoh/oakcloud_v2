const QR_VERSION = 6;
const QR_SIZE = 17 + QR_VERSION * 4;
const DATA_CODEWORDS = 108;
const BLOCK_COUNT = 4;
const DATA_CODEWORDS_PER_BLOCK = 27;
const ECC_CODEWORDS_PER_BLOCK = 16;
const MAX_BYTE_PAYLOAD = 106;

function reedSolomonMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomonComputeDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;

  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length) {
        result[j] ^= result[j + 1];
      }
    }
    root = reedSolomonMultiply(root, 0x02);
  }

  return result;
}

function reedSolomonComputeRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);

  for (const value of data) {
    const factor = value ^ result[0];
    result.shift();
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] ^= reedSolomonMultiply(coefficient, factor);
    });
  }

  return result;
}

function appendBits(target: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i -= 1) {
    target.push((value >>> i) & 1);
  }
}

function encodeDataCodewords(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)];
  if (bytes.length > MAX_BYTE_PAYLOAD) {
    throw new Error(`Verification URL is too long for the certificate QR code (${bytes.length} bytes)`);
  }

  const bits: number[] = [];
  appendBits(bits, 0b0100, 4); // Byte mode.
  appendBits(bits, bytes.length, 8); // Version 1-9 byte-count field.
  bytes.forEach((byte) => appendBits(bits, byte, 8));

  const capacityBits = DATA_CODEWORDS * 8;
  const terminatorLength = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminatorLength; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      byte = (byte << 1) | bits[i + bit];
    }
    codewords.push(byte);
  }

  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < DATA_CODEWORDS) {
    codewords.push(padBytes[padIndex % padBytes.length]);
    padIndex += 1;
  }

  return codewords;
}

function addErrorCorrection(dataCodewords: number[]): number[] {
  const divisor = reedSolomonComputeDivisor(ECC_CODEWORDS_PER_BLOCK);
  const blocks = Array.from({ length: BLOCK_COUNT }, (_, blockIndex) => {
    const start = blockIndex * DATA_CODEWORDS_PER_BLOCK;
    const data = dataCodewords.slice(start, start + DATA_CODEWORDS_PER_BLOCK);
    return {
      data,
      ecc: reedSolomonComputeRemainder(data, divisor),
    };
  });

  const result: number[] = [];
  for (let index = 0; index < DATA_CODEWORDS_PER_BLOCK; index += 1) {
    blocks.forEach((block) => result.push(block.data[index]));
  }
  for (let index = 0; index < ECC_CODEWORDS_PER_BLOCK; index += 1) {
    blocks.forEach((block) => result.push(block.ecc[index]));
  }
  return result;
}

export type QrMatrix = {
  size: number;
  modules: boolean[][];
};

/**
 * Generate a standards-compliant QR Code Model 2 matrix for the certificate URL.
 *
 * The certificate has a deliberately narrow, predictable payload shape, so a
 * fixed Version 6 / error-correction M symbol keeps the implementation small,
 * deterministic and dependency-free while still allowing up to 106 UTF-8 bytes.
 * Mask pattern 0 is valid for every symbol; using a fixed mask also makes PDF
 * generation deterministic across environments.
 */
export function generateCertificateQrMatrix(value: string): QrMatrix {
  const codewords = addErrorCorrection(encodeDataCodewords(value));
  const modules = Array.from({ length: QR_SIZE }, () => new Array<boolean>(QR_SIZE).fill(false));
  const isFunction = Array.from({ length: QR_SIZE }, () => new Array<boolean>(QR_SIZE).fill(false));

  const setFunctionModule = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= QR_SIZE || y >= QR_SIZE) return;
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  const drawFinder = (centerX: number, centerY: number) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunctionModule(centerX + dx, centerY + dy, distance !== 2 && distance !== 4);
      }
    }
  };

  const drawAlignment = (centerX: number, centerY: number) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setFunctionModule(
          centerX + dx,
          centerY + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
        );
      }
    }
  };

  drawFinder(3, 3);
  drawFinder(QR_SIZE - 4, 3);
  drawFinder(3, QR_SIZE - 4);

  for (let i = 0; i < QR_SIZE; i += 1) {
    if (!isFunction[6][i]) setFunctionModule(i, 6, i % 2 === 0);
    if (!isFunction[i][6]) setFunctionModule(6, i, i % 2 === 0);
  }

  const alignmentCenters = [6, 34];
  alignmentCenters.forEach((y) => {
    alignmentCenters.forEach((x) => {
      if (!isFunction[y][x]) drawAlignment(x, y);
    });
  });

  const drawFormatBits = (mask: number) => {
    // Error-correction level M is encoded as 00.
    const data = mask;
    let remainder = data;
    for (let i = 0; i < 10; i += 1) {
      remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    }
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const getBit = (index: number) => ((bits >>> index) & 1) !== 0;

    for (let i = 0; i <= 5; i += 1) setFunctionModule(8, i, getBit(i));
    setFunctionModule(8, 7, getBit(6));
    setFunctionModule(8, 8, getBit(7));
    setFunctionModule(7, 8, getBit(8));
    for (let i = 9; i < 15; i += 1) setFunctionModule(14 - i, 8, getBit(i));

    for (let i = 0; i < 8; i += 1) setFunctionModule(QR_SIZE - 1 - i, 8, getBit(i));
    for (let i = 8; i < 15; i += 1) setFunctionModule(8, QR_SIZE - 15 + i, getBit(i));
    setFunctionModule(8, QR_SIZE - 8, true);
  };

  // Reserve the format-information modules before data placement.
  drawFormatBits(0);

  const dataBits: number[] = [];
  codewords.forEach((codeword) => appendBits(dataBits, codeword, 8));
  let bitIndex = 0;

  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? QR_SIZE - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        if (isFunction[y][x]) continue;
        modules[y][x] = bitIndex < dataBits.length ? dataBits[bitIndex] === 1 : false;
        bitIndex += 1;
      }
    }
  }

  // Mask pattern 0: (x + y) is even. Apply only to data/remainder modules.
  for (let y = 0; y < QR_SIZE; y += 1) {
    for (let x = 0; x < QR_SIZE; x += 1) {
      if (!isFunction[y][x] && (x + y) % 2 === 0) {
        modules[y][x] = !modules[y][x];
      }
    }
  }

  // Restore final format bits after masking.
  drawFormatBits(0);

  return { size: QR_SIZE, modules };
}
