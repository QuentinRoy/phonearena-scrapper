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

const inchesToMM = inches => inches * 25.4;

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

let s;

// Walk through the spec hierarchy and find an item.
const findScrappingItemByName = (itemList, currentItemName, ...subItemPath) => {
  if (!itemList) log.debug('wtf', s, currentItemName);
  const item = itemList.find(item_ => item_.name === currentItemName);
  // console.log({ itemList, item, currentItemName, subItemPath });
  if (!item) return undefined;
  if (subItemPath.length > 0) {
    return findScrappingItemByName(item.items, ...subItemPath);
  }
  return item.value;
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

const parseDisplayResolution = (displayResolution = '') => {
  const match = /(\d+)\s*(?:x|х)\s*(\d+)/.exec(displayResolution) || [];
  const [parsedDisplayPixelWidth, parsedDisplayPixelHeight] = match
    .slice(1, 3)
    .map(x => +x.replace(',', '.'));
  return { parsedDisplayPixelWidth, parsedDisplayPixelHeight };
};

const scrappingTransform = new Transform({
  objectMode: true,
  transform(scrapping, encoding, callback) {
    s = scrapping;
    const findMetaInfoItem = (...args) =>
      findScrappingItemByName(scrapping.metaInfo, ...args);
    const findSpecItem = (...args) =>
      findScrappingItemByName(scrapping.specs, ...args);

    // Parse some design stuff.
    const releaseDate = findMetaInfoItem('Release date');
    const marketStatus = findMetaInfoItem('Market status');
    const announceDate = findMetaInfoItem('Announced');

    const dimensions = findSpecItem('Design', 'Dimensions');
    const weight = findSpecItem('Design', 'Weight');
    const formFactor = findSpecItem('Design', 'Form factor');
    const os = findSpecItem('Design', 'OS');
    const displaySize = findSpecItem('Display', 'Physical size');
    const displayResolution = findSpecItem('Display', 'Resolution');
    const screenToBodyRatio = findSpecItem('Display', 'Screen-to-body ratio');

    this.push({
      name: scrapping.name,
      brand: scrapping.brand,
      type: scrapping.type,
      releaseDate,
      parsedReleaseDate: normalizeDate(releaseDate),
      marketStatus,
      announceDate,
      parsedAnnounceDate: normalizeDate(announceDate),
      dimensions,
      ...parseDimension(dimensions),
      weight,
      parsedWeight: parseWeight(weight),
      formFactor,
      os,
      displaySize,
      parsedDisplayMMDiagonal:
        displaySize && inchesToMM(parseInt(displaySize, 10)),
      displayResolution,
      ...parseDisplayResolution(displayResolution),
      screenToBodyRatio,
      parsedScreenToBodyRatio:
        screenToBodyRatio && parseFloat(screenToBodyRatio) / 100,
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
