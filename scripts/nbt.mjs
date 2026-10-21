// Minimal reader for the gzipped NBT in Hypixel's `item_bytes` (big-endian, Java edition).
import { gunzipSync } from 'node:zlib';

export function parseNbt(buf) {
  let o = 0;
  const u8 = () => buf.readUInt8(o++);
  const i16 = () => { const v = buf.readInt16BE(o); o += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; };

  function payload(type) {
    switch (type) {
      case 1: return buf.readInt8(o++);
      case 2: return i16();
      case 3: return i32();
      case 4: { const v = buf.readBigInt64BE(o); o += 8; return Number(v); }
      case 5: { const v = buf.readFloatBE(o); o += 4; return v; }
      case 6: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case 7: { const n = i32(); const v = buf.subarray(o, o + n); o += n; return v; }
      case 8: return str();
      case 9: { const t = u8(); const n = i32(); const a = []; for (let i = 0; i < n; i++) a.push(payload(t)); return a; }
      case 10: {
        const obj = {};
        for (;;) {
          const t = u8();
          if (t === 0) return obj;
          const name = str();
          obj[name] = payload(t);
        }
      }
      case 11: { const n = i32(); const a = []; for (let i = 0; i < n; i++) a.push(i32()); return a; }
      case 12: { const n = i32(); o += n * 8; return []; }
      default: throw new Error(`Unknown NBT tag ${type} at ${o}`);
    }
  }

  const rootType = u8();
  if (rootType !== 10) throw new Error('NBT root is not a compound');
  str();
  return payload(10);
}

/**
 * Returns the SkyBlock id for an auction's item_bytes.
 * Single-enchant books become ENCHANTMENT_<NAME>_<LEVEL> to match Bazaar ids.
 */
export function skyblockIdFromItemBytes(b64) {
  const root = parseNbt(gunzipSync(Buffer.from(b64, 'base64')));
  const item = root.i?.[0];
  const extra = item?.tag?.ExtraAttributes;
  if (!extra?.id) return null;
  if (extra.id === 'ENCHANTED_BOOK' && extra.enchantments) {
    const entries = Object.entries(extra.enchantments);
    if (entries.length === 1) {
      const [name, level] = entries[0];
      return `ENCHANTMENT_${name.toUpperCase()}_${level}`;
    }
  }
  return extra.id;
}
