import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { skyblockIdFromItemBytes } from './nbt.mjs';
import { loadLocations, validateLocation } from './validate-data.mjs';

// Tiny NBT writer, just enough to build test fixtures shaped like auction item_bytes.
function name(s) {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
}
const tagString = (k, v) => Buffer.concat([Buffer.from([8]), name(k), name(v)]);
const tagInt = (k, v) => { const b = Buffer.alloc(4); b.writeInt32BE(v); return Buffer.concat([Buffer.from([3]), name(k), b]); };
const tagByte = (k, v) => Buffer.concat([Buffer.from([1]), name(k), Buffer.from([v])]);
const compound = (k, ...children) => Buffer.concat([Buffer.from([10]), name(k), ...children, Buffer.from([0])]);
function listOfCompounds(k, ...bodies) {
  const n = Buffer.alloc(4);
  n.writeInt32BE(bodies.length);
  return Buffer.concat([Buffer.from([9]), name(k), Buffer.from([10]), n, ...bodies.map((b) => Buffer.concat([b, Buffer.from([0])]))]);
}
function itemBytes(extraChildren) {
  const item = Buffer.concat([tagByte('Count', 1), compound('tag', compound('ExtraAttributes', ...extraChildren))]);
  const root = compound('', listOfCompounds('i', item));
  return gzipSync(root).toString('base64');
}

describe('auction item_bytes decoding', () => {
  it('reads ExtraAttributes.id', () => {
    expect(skyblockIdFromItemBytes(itemBytes([tagString('id', 'RADIOACTIVE_VIAL')]))).toBe('RADIOACTIVE_VIAL');
  });

  it('maps single-enchant books to Bazaar-style ids', () => {
    const book = itemBytes([tagString('id', 'ENCHANTED_BOOK'), compound('enchantments', tagInt('ultimate_flash', 1))]);
    expect(skyblockIdFromItemBytes(book)).toBe('ENCHANTMENT_ULTIMATE_FLASH_1');
  });
});

describe('data files', () => {
  it('pass validation', () => {
    expect(loadLocations().flatMap(validateLocation)).toEqual([]);
  });
});
