import * as Y from "yjs";

type DecodedUpdate = ReturnType<typeof Y.decodeUpdate>;
type DecodedStruct = DecodedUpdate["structs"][number];
type DecodedDeleteSet = DecodedUpdate["ds"];

/**
 * Splits one Yjs V1 update into ordered updates of at most `maxBytes`.
 * Struct prefixes are re-encoded in their original order. The delete set is
 * written only on the last chunk so a delete is not applied before the struct
 * it refers to. A single struct that itself encodes larger than `maxBytes` is
 * returned as one oversized chunk.
 */
export function splitDocumentUpdate(update: Uint8Array, maxBytes: number): Uint8Array[] {
  if (update.byteLength === 0) return [];
  if (maxBytes < 1 || update.byteLength <= maxBytes) return [update];

  let decoded: DecodedUpdate;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return [update];
  }

  const { structs, ds } = decoded;
  if (structs.length === 0) return [update];

  const chunks: Uint8Array[] = [];
  const deleteSetPending = ds.clients.size > 0;
  let deleteSetWritten = !deleteSetPending;
  let index = 0;

  while (index < structs.length) {
    const remaining = structs.slice(index);
    const rest = encodeStructs(remaining, deleteSetWritten ? null : ds);
    if (rest.byteLength <= maxBytes) {
      chunks.push(rest);
      deleteSetWritten = true;
      break;
    }

    const count = largestFittingCount(structs, index, remaining.length, maxBytes);
    const take = Math.min(Math.max(count, 1), remaining.length);
    chunks.push(encodeStructs(remaining.slice(0, take), null));
    index += take;
  }

  if (!deleteSetWritten) {
    const deleteSetOnly = encodeStructs([], ds);
    if (deleteSetOnly.byteLength > 2) chunks.push(deleteSetOnly);
  }

  return chunks.filter((chunk) => chunk.byteLength > 2);
}

function largestFittingCount(
  structs: DecodedStruct[],
  start: number,
  maxCount: number,
  maxBytes: number,
): number {
  if (maxCount <= 0) return 0;

  const sizeOf = (count: number) =>
    encodeStructs(structs.slice(start, start + count), null).byteLength;

  if (sizeOf(1) > maxBytes) return 1;

  let best = 1;
  let probe = 1;
  while (probe < maxCount) {
    const next = Math.min(maxCount, probe * 2);
    if (sizeOf(next) <= maxBytes) {
      best = next;
      if (next === maxCount) return best;
      probe = next;
      continue;
    }

    let lo = best + 1;
    let hi = next - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sizeOf(mid) <= maxBytes) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  return best;
}

function encodeStructs(structs: DecodedStruct[], deleteSet: DecodedDeleteSet | null): Uint8Array {
  const encoder = new Y.UpdateEncoderV1();
  const groups: { client: number; structs: DecodedStruct[] }[] = [];

  for (const struct of structs) {
    const client = struct.id.client;
    const current = groups.at(-1);
    const previous = current?.structs.at(-1);
    const contiguous =
      previous !== undefined &&
      previous.id.client === client &&
      previous.id.clock + previous.length === struct.id.clock;
    if (current && contiguous) {
      current.structs.push(struct);
    } else {
      groups.push({ client, structs: [struct] });
    }
  }

  encoder.writeLen(groups.length);
  for (const group of groups) {
    const first = group.structs[0];
    if (!first) continue;
    encoder.writeLen(group.structs.length);
    encoder.writeClient(first.id.client);
    encoder.writeLen(first.id.clock);
    for (const struct of group.structs) {
      struct.write(encoder, 0);
    }
  }

  writeDeleteSet(encoder, deleteSet);
  return encoder.toUint8Array();
}

function writeDeleteSet(encoder: Y.UpdateEncoderV1, deleteSet: DecodedDeleteSet | null): void {
  if (deleteSet === null || deleteSet.clients.size === 0) {
    encoder.writeLen(0);
    return;
  }

  const clients = [...deleteSet.clients.entries()].sort((left, right) => right[0] - left[0]);
  encoder.writeLen(clients.length);
  for (const [client, items] of clients) {
    encoder.resetDsCurVal();
    encoder.writeClient(client);
    encoder.writeLen(items.length);
    for (const item of items) {
      encoder.writeDsClock(item.clock);
      encoder.writeDsLen(item.len);
    }
  }
}
