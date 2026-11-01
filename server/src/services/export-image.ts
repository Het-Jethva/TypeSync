import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";
import { AppError } from "../middleware/error.js";
import { MAX_IMAGE_BYTES, normalizeDocumentImage } from "./document-image.js";

export function isPublicAddress(address: string): boolean {
  return ipaddr.isValid(address) && ipaddr.process(address).range() === "unicast";
}

export function externalImageUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError(400, "An image has an invalid URL"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
      (url.port && !["80", "443"].includes(url.port))) {
    throw new AppError(400, "Image URLs must use HTTP or HTTPS without credentials or custom ports");
  }
  return url;
}

export async function fetchExportImage(source: string, signal: AbortSignal) {
  let url = externalImageUrl(source);
  for (let redirect = 0; redirect <= 4; redirect++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = ipaddr.isValid(hostname)
      ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === "ipv4" ? 4 : 6 }]
      : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new AppError(400, "PDF images cannot use local or private network addresses");
    }
    const target = addresses[0];
    if (!target) throw new AppError(400, "Image host could not be resolved");
    const agent = new Agent({ connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [target]);
        else callback(null, target.address, target.family);
      },
    } });
    try {
      const response = await fetch(url, {
        dispatcher: agent,
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
        headers: { accept: "image/png,image/jpeg,image/webp" },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new AppError(400, "An image redirect has no destination");
        url = externalImageUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok || !response.body) throw new AppError(422, "An external image could not be downloaded");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_IMAGE_BYTES) throw new AppError(413, "An external image exceeds 10 MiB");
        chunks.push(Buffer.from(chunk));
      }
      return await normalizeDocumentImage(Buffer.concat(chunks));
    } finally {
      await agent.destroy();
    }
  }
  throw new AppError(422, "An image has too many redirects");
}
