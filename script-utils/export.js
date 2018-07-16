const fs = require('fs');
const { Transform } = require('stream');
const path = require('path');
const log = require('loglevel');
const program = require('commander');
const csvStringify = require('csv-stringify');
const moment = require('moment');
const { promisify } = require('util');

const { version } = require('../package.json');

const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);

log.setDefaultLevel('debug');

program
  .version(version)
  .arguments('<directory>')
  .parse(process.argv);

const outputDirectory = program.args[0];

if (!outputDirectory) {
  program.outputHelp();
  process.exit(1);
}

const fileReaderTransform = new Transform({
  decodeStrings: false,
  objectMode: true,
  transform(filePath, encoding, callback) {
    readFile(filePath)
      .then(data => {
        this.push(JSON.parse(data.toString()));
        callback();
      })
      .catch(e => callback(e));
  },
});

const normalizeDate = date => {
  if (!date) return null;
  const quarterMatch = /^Q(\d)\s+(\d\d\d\d)/i.exec(date);
  if (quarterMatch) {
    return new Date(
      quarterMatch[2],
      (12 / 4) * quarterMatch[1] - 1,
    ).toISOString();
  }
  return moment(
    date,
    ['MMM  DD, YYYY', 'MMMM YYYY', 'YYYY'],
    'en',
  ).toISOString();
};

const parseDimension = (dimensionsStr = '') => {
  // Some dimensions have a special 'x' character. Some use ',' instead of '.'.
  const dimMatch =
    /\(\s*(\d+(?:(?:\.|,)\d+)?)\s*(?:x|х)\s*(\d+(?:(?:\.|,)\d+)?)\s*(?:x|х)\s*(\d+(?:(?:\.|,)\d+)?)\s*mm\s*\)/.exec(
      dimensionsStr,
    ) || [];
  const [parsedHeight, parsedWidth, parsedThickness] = dimMatch
    .slice(1, 4)
    .map(x => +x.replace(',', '.'));
  return { parsedHeight, parsedWidth, parsedThickness };
};

const parseWeight = weightStr =>
  (/\(\s*(\d+((\.|,)\d+)?)\s*g\s*\)/.exec(weightStr) || [])
    .slice(1, 2)
    .map(x => +x.replace(',', '.'))[0];

const scrappingTransform = new Transform({
  objectMode: true,
  transform(scrapping, encoding, callback) {
    const metaInfo = scrapping.metaInfo.reduce(
      (res, i) => ({ ...res, [i.name]: i.value }),
      {},
    );
    const designSpec = scrapping.specs.find(spec => spec.name === 'Design');
    const dimensionSpec =
      designSpec && designSpec.items.find(item => item.name === 'Dimensions');
    const weightSpec =
      designSpec && designSpec.items.find(item => item.name === 'Weight');
    const formFactorSpec =
      designSpec && designSpec.items.find(item => item.name === 'Form factor');
    const parsedDimensions = parseDimension(
      dimensionSpec && dimensionSpec.value,
    );
    const parsedWeight = parseWeight(weightSpec && weightSpec.value);

    this.push({
      name: scrapping.name,
      brand: scrapping.brand,
      releaseDate: metaInfo['Release date'] || null,
      parsedReleaseDate: normalizeDate(metaInfo['Release date']),
      announceDate: metaInfo.Announced || null,
      parsedAnnounceDate: normalizeDate(metaInfo.Announced),
      dimension: (dimensionSpec && dimensionSpec.value) || null,
      ...parsedDimensions,
      weight: weightSpec && weightSpec.value,
      parsedWeight,
      formFactor: formFactorSpec && formFactorSpec.value,
      scrappedPage: scrapping.address,
    });
    callback();
  },
});

fileReaderTransform
  .pipe(scrappingTransform)
  .pipe(csvStringify({ header: true }))
  .pipe(process.stdout);

readdir(outputDirectory)
  .then(filePaths => {
    filePaths
      .filter(filePath => filePath.endsWith('.json'))
      .forEach(filePath => {
        fileReaderTransform.write(path.join(outputDirectory, filePath));
      });
  })
  .catch(log.error);
