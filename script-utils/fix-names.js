// Script used to update the phone data if getPhoneFileName has changed.

const { readdir, readFile, mkdir, copyFile } = require('fs').promises;
const { resolve, extname, basename } = require('path');
const log = require('loglevel');
const { getPhoneId } = require('../modules/utils');

const DIR_TO_FIX = resolve(__dirname, '../out');
const OUTPUT_DIR = resolve(__dirname, '../fixed-out');

log.setDefaultLevel('debug');

const main = async () => {
  await mkdir(OUTPUT_DIR);
  const files = await readdir(DIR_TO_FIX);
  return Promise.all(
    files.filter(f => f.endsWith('.json')).map(async sourceName => {
      const fPath = resolve(DIR_TO_FIX, sourceName);
      const { address, image } = await readFile(fPath).then(JSON.parse);
      const id = getPhoneId({ address });

      // Copy the file.
      await copyFile(fPath, resolve(OUTPUT_DIR, `${id}.json`));
      log.debug(`${sourceName}\t->\t${id}.json`);

      // Copy the image (if any).
      if (image) {
        const imageExt = extname(image);
        log.debug(imageExt);
        const imagePath = resolve(
          DIR_TO_FIX,
          `${basename(sourceName, '.json')}${imageExt}`,
        );
        await copyFile(imagePath, resolve(OUTPUT_DIR, `${id}${imageExt}`));
        log.debug(`${imagePath}\t->\t${id}${imageExt}`);
      }
    }),
  );
};

main().catch(e => {
  log.error(e);
  process.exit(1);
});
