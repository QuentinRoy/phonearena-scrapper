// Script used to update the phone data if getPhoneFileName has changed.

const { readdir, readFile, mkdir, copyFile } = require('fs').promises;
const { resolve } = require('path');
const log = require('loglevel');
const { getPhoneFileName } = require('../modules/utils');

const DIR_TO_FIX = resolve(__dirname, '../out');
const OUTPUT_DIR = resolve(__dirname, '../fixed-out');

log.setDefaultLevel('debug');

const main = async () => {
  await mkdir(OUTPUT_DIR);
  const files = await readdir(DIR_TO_FIX);
  return Promise.all(
    files.map(async sourceName => {
      const fPath = resolve(DIR_TO_FIX, sourceName);
      const { address } = await readFile(fPath).then(JSON.parse);
      const targetName = getPhoneFileName({ address });
      await copyFile(fPath, resolve(OUTPUT_DIR, targetName));
      log.debug(`${sourceName}    ->    ${targetName}`);
    }),
  );
};

main().catch(e => {
  log.error(e);
  process.exit(1);
});
