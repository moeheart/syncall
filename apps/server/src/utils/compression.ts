import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export async function compressBuffer(input: Buffer): Promise<Buffer> {
  return gzipAsync(input);
}

export async function decompressBuffer(input: Buffer): Promise<Buffer> {
  return gunzipAsync(input);
}

