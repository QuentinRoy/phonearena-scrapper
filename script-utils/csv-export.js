const fs = require('fs');
const { Transform } = require('stream');
const path = require('path');
const log = require('loglevel');
const program = require('commander');
const csvStringify = require('csv-stringify');
const moment = require('moment');
const compareVersions = require('compare-versions');
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

const scrappingListSearch = (
  array,
  targetPath,
  { valueProp = 'value', nameProp = 'name', itemsProp = 'items' } = {},
) => {
  const [currentItemName, ...subItemPath] = targetPath;
  const item = array.find(
    item_ =>
      item_[nameProp] && item_[nameProp].trim() === currentItemName.trim(),
  );
  if (!item) return undefined;
  if (subItemPath.length > 0) {
    return scrappingListSearch(item[itemsProp], subItemPath, {
      valueProp,
      nameProp,
      itemsProp,
    });
  }
  return item[valueProp];
};

const parseDimension = (dimensionsStr = '') => {
  // Some dimensions have a special 'x' character. Some use ',' instead of '.'.
  const dimMatch =
    /\(\s*((?:\d|\.)+)\s*(?:x|х)\s*((?:\d|\.)+)\s*(?:x|х)\s*((?:\d|\.)+)\s*(?:mm\s*)?\)/i.exec(
      dimensionsStr,
    ) || [];
  const [parsedHeight, parsedWidth, parsedThickness] = dimMatch
    .slice(1, 4)
    .map(x => parseFloat(x.replace(',', '.')));
  return { parsedHeight, parsedWidth, parsedThickness };
};

const parseWeight = (weightStr = '') =>
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

const parseOS = (os = '') =>
  (/^\s*((?:[a-z0-9\-_\s])*[a-z0-9])/i.exec(os) || [])[1];

const scrappingTransform = new Transform({
  objectMode: true,
  transform(scrapping, encoding, callback) {
    const findMetaInfoItem = (...args) =>
      scrappingListSearch(scrapping.metaInfo, args);
    const findSpecItem = (...args) =>
      scrappingListSearch(scrapping.specs, args);

    // Parse some design stuff.
    const releaseDate = findMetaInfoItem('Release date');
    const marketStatus = findMetaInfoItem('Market status');
    const announceDate = findMetaInfoItem('Announced');

    const dimensions = findSpecItem('Design', 'Dimensions');
    const weight = findSpecItem('Design', 'Weight');
    const formFactor = findSpecItem('Design', 'Form factor');
    const OS = findSpecItem('Design', 'OS');
    const deviceType = findSpecItem('Design', 'Device type');
    const displaySize =
      findSpecItem('Display', 'Physical size') ||
      findSpecItem('Display', 'Display size');
    const displayResolution = findSpecItem('Display', 'Resolution');
    const screenToBodyRatio = findSpecItem('Display', 'Screen-to-body ratio');
    const displayTouch = findSpecItem('Display', 'Touchscreen');
    const cellularData = findSpecItem('Cellular', 'Data');
    const cellularGSM = findSpecItem('Cellular', 'GSM');
    const phoneArenaRating =
      scrapping.scrapperVersion &&
      compareVersions(scrapping.scrapperVersion, '0.7.0') >= 0
        ? scrappingListSearch(scrapping.ratings || [], ['PhoneArena'])
        : scrappingListSearch(scrapping.ratings || [], ['PhoneArena rating:'], {
            valueProp: 1,
          });
    const userRating =
      scrapping.scrapperVersion &&
      compareVersions(scrapping.scrapperVersion, '0.7.0') >= 0
        ? scrappingListSearch(scrapping.ratings || [], ['User'])
        : scrappingListSearch(scrapping.ratings || [], ['User rating:'], {
            nameProp: 0,
            valueProp: 1,
          });
    const userRatingTotalVotes =
      scrapping.scrapperVersion &&
      compareVersions(scrapping.scrapperVersion, '0.7.0') >= 0
        ? scrappingListSearch(scrapping.ratings || [], ['User'], {
            valueProp: 'totalVotes',
          })
        : undefined;

    this.push({
      id: scrapping.scrapId,
      name: scrapping.name,
      brand: scrapping.brand,
      deviceType,
      address: scrapping.address,
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
      OS,
      parsedOS: parseOS(OS),
      cellularData,
      cellularGSM,
      displayTouch,
      parsedMultiTouch: displayTouch
        ? displayTouch
            .toLowerCase()
            .replace('-', '')
            .includes('multitouch')
        : false,
      displaySize,
      parsedDisplayMMDiagonal:
        displaySize && inchesToMM(parseFloat(displaySize)),
      displayResolution,
      ...parseDisplayResolution(displayResolution),
      screenToBodyRatio,
      parsedScreenToBodyRatio:
        screenToBodyRatio && parseFloat(screenToBodyRatio) / 100,
      phoneArenaRating,
      userRating,
      userRatingTotalVotes,
      visitorsWhoWantIt: scrapping.visitorsWhoWantIt,
      visitorsWhoHaveIt: scrapping.visitorsWhoHaveIt,
      visitorsWhoHadIt: scrapping.visitorsWhoHadIt,
      scrappedPage: scrapping.address,
      scrapDate: scrapping.scrapDate,
      scrapper: scrapping.scrapper,
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
