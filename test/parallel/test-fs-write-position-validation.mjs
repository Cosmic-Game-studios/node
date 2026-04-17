import * as common from '../common/index.mjs';
import tmpdir from '../common/tmpdir.js';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import assert from 'assert';

// This test ensures that the `position` argument is correctly validated by
// fs.write(), fs.writeSync() and fsPromises.FileHandle.write(). The symmetric
// validation was added to fs.read()/readSync() by commit ed05549e; the write
// counterparts were left unchecked and silently accepted invalid values such
// as strings, objects and out-of-range numbers.

tmpdir.refresh();
const filepath = path.join(tmpdir.path, 'test-fs-write-position-validation.txt');
fs.writeFileSync(filepath, Buffer.alloc(32, 0x2e));

const buffer = Buffer.from('xyz\n');
const offset = 0;
const length = buffer.byteLength;

async function testValidAsync(position) {
  return new Promise((resolve, reject) => {
    fs.open(filepath, 'r+', common.mustSucceed((fd) => {
      let callCount = 3;
      const handler = common.mustCall((err) => {
        callCount--;
        if (err) {
          fs.close(fd, common.mustSucceed());
          reject(err);
        } else if (callCount === 0) {
          fs.close(fd, common.mustSucceed(resolve));
        }
      }, callCount);
      fs.write(fd, buffer, offset, length, position, handler);
      fs.write(fd, buffer, { offset, length, position }, handler);
      fs.write(fd, buffer, common.mustNotMutateObjectDeep({ offset, length, position }), handler);
    }));
  });
}

function testInvalidAsync(code, position) {
  return new Promise((resolve, reject) => {
    fs.open(filepath, 'r+', common.mustSucceed((fd) => {
      try {
        assert.throws(
          () => fs.write(fd, buffer, offset, length, position, common.mustNotCall()),
          { code },
        );
        assert.throws(
          () => fs.write(fd, buffer, { offset, length, position }, common.mustNotCall()),
          { code },
        );
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        fs.close(fd, common.mustSucceed());
      }
    }));
  });
}

function testInvalidSync(code, position) {
  const fd = fs.openSync(filepath, 'r+');
  try {
    assert.throws(
      () => fs.writeSync(fd, buffer, offset, length, position),
      { code },
    );
    assert.throws(
      () => fs.writeSync(fd, buffer, { offset, length, position }),
      { code },
    );
  } finally {
    fs.closeSync(fd);
  }
}

async function testInvalidPromise(code, position) {
  const fh = await fsp.open(filepath, 'r+');
  try {
    await assert.rejects(
      fh.write(buffer, offset, length, position),
      { code },
    );
    await assert.rejects(
      fh.write(buffer, { offset, length, position }),
      { code },
    );
  } finally {
    await fh.close();
  }
}

// Valid positions must continue to work.
await testValidAsync(undefined);
await testValidAsync(null);
await testValidAsync(0);
await testValidAsync(1);
await testValidAsync(0n);
await testValidAsync(1n);

// Out-of-range numeric positions must be rejected.
for (const bad of [-2, NaN, -Infinity, Infinity, -0.999,
                   Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE]) {
  await testInvalidAsync('ERR_OUT_OF_RANGE', bad);
  testInvalidSync('ERR_OUT_OF_RANGE', bad);
  await testInvalidPromise('ERR_OUT_OF_RANGE', bad);
}

// Out-of-range bigint positions must be rejected.
for (const bad of [2n ** 63n, -(2n ** 64n)]) {
  await testInvalidAsync('ERR_OUT_OF_RANGE', bad);
  testInvalidSync('ERR_OUT_OF_RANGE', bad);
  await testInvalidPromise('ERR_OUT_OF_RANGE', bad);
}

// Non-integer types must be rejected with ERR_INVALID_ARG_TYPE.
for (const bad of [false, true, '1', 'not-a-number', Symbol(1), {}, []]) {
  await testInvalidAsync('ERR_INVALID_ARG_TYPE', bad);
  testInvalidSync('ERR_INVALID_ARG_TYPE', bad);
  await testInvalidPromise('ERR_INVALID_ARG_TYPE', bad);
}
