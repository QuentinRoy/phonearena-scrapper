const puppeteer = require('puppeteer');
const log = require('loglevel');
const path = require('path');
const fs = require('fs');
const util = require('util');
const moment = require('moment');
const program = require('commander');
const { version, name: scrapperName } = require('./package.json');
const {
  scrapeListingPageAddresses,
  scrapePhoneAddressFromListingPage,
} = require('./modules/scrape-phones-listing');
const scrapePhonePage = require('./modules/scrape-phone-page');
const PageManager = require('./modules/page-manager');
const { retry, download, getPhoneId } = require('./modules/utils');

const writeFile = util.promisify(fs.writeFile);
const readFile = util.promisify(fs.readFile);
const exists = util.promisify(fs.exists);
const mkdir = util.promisify(fs.mkdir);

const TIME_WINDOW = 10 * 1000;
const LISTING_PAGE_ADDRESS = 'https://www.phonearena.com/phones';

log.setDefaultLevel('info');

program
  .version(version)
  .option(
    '-u, --update [date]',
    'Update (re-scape) existing data file if they were scrapped before the provided date.',
    moment,
  )
  .option(
    '-c, --concurrency <n>',
    'Number of parallel scrapping',
    x => parseInt(x, 10),
    10,
  )
  .option(
    '-s, --scrapping-retry <n>',
    'Number of time a scrapping should be retried if failed',
    x => parseInt(x, 10),
    1,
  )
  .option(
    '-l, --loading-retry <n>',
    'Number of time a page loading should be retried if failed',
    x => parseInt(x, 10),
    3,
  )
  .option(
    '--listing  <path>',
    'The path of file where the address of every phones to scrap are listed',
  )
  .option(
    '--listing-output <path>',
    'The path of file where the write down the listing of the phones to scrap',
  )
  .option(
    '--listing-only',
    'Only scrap phone listings, but not the phone themselves',
  )
  .option(
    '--no-headless',
    'If the scrapping should happening without showing the browser',
  )
  .option('-o, --output-dir <path>', 'Output directory', './out')
  .option('-s, --success-only', 'Stop at the first unsuccessful scrapping')
  .option('--no-image-download')
  .parse(process.argv);

// const {
//   outputDir,
//   successOnly,
//   update,
//   concurrency,
//   loadingRetry,
//   scrappingRetry,
//   headless,
//   imageDownload,
//   listing,
//   listingOutput,
//   listingOnly,
// } = program;

const scrappingSpeed = (done, start) => done / (Date.now() - start);

const scrapPhoneListings = async ({ pageManager, start }, options) => {
  const retryT = retry(options.scrappingRetry);
  let doneRecently = 0;
  let done = 0;
  const speed = () =>
    scrappingSpeed(doneRecently, Math.max(start, Date.now() - TIME_WINDOW));

  // Get all listing pages.
  const allListingPages = await pageManager.withPage(
    LISTING_PAGE_ADDRESS,
    scrapeListingPageAddresses,
  );
  const nListings = allListingPages.length;

  log.info(`> Found ${nListings} list pages. Scrapping phones listings...`);

  // Scrap them.
  const addressGroups = await Promise.all(
    allListingPages.map(
      retryT(() => async addr => {
        const r = await pageManager.withPage(addr, page => {
          log.debug(`> Scrapping listing at ${addr}`);
          return scrapePhoneAddressFromListingPage(page);
        });
        done += 1;
        doneRecently += 1;
        setTimeout(() => {
          doneRecently -= 1;
        }, TIME_WINDOW);
        log.info(
          `${addr} scrapped (${done}/${nListings}, speed: ${Math.round(
            speed() * 60000,
          )}/min, time elapsed: ${moment
            .duration(Date.now() - start)
            .humanize()})`,
        );

        return r;
      }),
    ),
  );
  return addressGroups
    .reduce((acc, result) => acc.concat(result), [])
    .map(({ address }) => address);
};

// Scrap and every phones in phone addresses and write their data.
const scrapPhones = async ({ pageManager, start, phoneAddresses }, options) => {
  let hasFailed = false;
  let phonePagesDone = 0;
  let doneRecently = 0;
  let noUpdatedRecords = 0;
  const n = phoneAddresses.length;
  const retryT = retry(options.scrappingRetry);
  const speed = () =>
    scrappingSpeed(doneRecently, Math.max(start, Date.now() - TIME_WINDOW));

  // Create the directory for the phone's data.
  if (!(await exists(options.outputDir))) {
    await mkdir(options.outputDir);
  }

  await Promise.all(
    phoneAddresses.map(async address => {
      const id = getPhoneId({ address });
      try {
        const outputFile = path.resolve(options.outputDir, `${id}.json`);
        if (options.update !== true && (await exists(outputFile))) {
          let shouldNotUpdate;
          if (options.update == null) {
            shouldNotUpdate = true;
          } else {
            const lastScrapDate = JSON.parse(await readFile(outputFile))
              .scrapDate;
            shouldNotUpdate = moment(lastScrapDate).diff(options.update) >= 0;
          }
          if (shouldNotUpdate) {
            phonePagesDone += 1;
            noUpdatedRecords += 1;
            log.debug(`> Not updating ${address}`);
            return;
          }
        }
        const phoneData = await retryT(() =>
          pageManager.withPage(address, async page => {
            log.debug(`> Scrapping phone at "${address}"...`);
            try {
              const res = await scrapePhonePage(page);
              log.debug(`> Done scrapping "${res.brand} ${res.name}"`);
              return {
                ...res,
                address,
                scrapId: id,
                scrapDate: new Date().toISOString(),
                scrapper: `${scrapperName} v${version}`,
              };
            } catch (e) {
              log.error(`> Error while scrapping phone at ${address}`);
              log.error(e);
              await new Promise(resolve => setTimeout(resolve, 5000));
              throw e;
            }
          }),
        );

        // Download the image.
        if (options.imageDownload && phoneData.image) {
          const imageExt = path.extname(/^[^(?|#)]+/.exec(phoneData.image)[0]);
          log.debug(`> Downloading image for phone "${phoneData.name}"...`);
          await download(
            phoneData.image,
            path.resolve(path.dirname(outputFile), `${id}${imageExt}`),
          );
        }

        log.debug(`> Writing "${phoneData.name}" data...`);

        // Write the file.
        await writeFile(outputFile, JSON.stringify(phoneData, null, 2));

        phonePagesDone += 1;
        doneRecently += 1;
        setTimeout(() => {
          doneRecently -= 1;
        }, TIME_WINDOW);
        const eta = (n - phonePagesDone) / speed();
        log.info(
          `"${phoneData.brand} ${
            phoneData.name
          }" scrapped (${phonePagesDone}/${n}, speed: ${Math.round(
            speed() * 60000,
          )}/min, time elapsed: ${moment
            .duration(Date.now() - start)
            .humanize()}, ETA: ${moment.duration(eta).humanize()})`,
        );
      } catch (e) {
        hasFailed = true;
        log.error(`Failed while scrapping phone at ${address}`);
        if (options.successOnly) throw e;
        else log.error(e);
      }
    }),
  );
  log.info(`${noUpdatedRecords} phone scrapping were found and kept as is.`);
  return hasFailed;
};

const main = async options => {
  const browser = await puppeteer.launch({ headless: options.headless });
  const pageManager = PageManager(browser, options.concurrency, {
    retry: options.loadingRetry,
  });
  await browser.pages().then(pages => pages.forEach(p => pageManager.give(p)));
  const start = Date.now();

  // Scrape phone addresses or read them from the listing file.
  const phoneAddresses = options.listing
    ? await readFile(options.listing).then(buffer =>
        buffer.toString().split('\n'),
      )
    : await scrapPhoneListings({ pageManager, start }, options);

  if (options.listingOutput) {
    await writeFile(options.listingOutput, phoneAddresses.join('\n'));
  }

  log.debug({ listingOnly: options.listingOnly });

  // If only listings should be scraped, return false to indicate that the
  // operation was successful.
  if (options.listingOnly) return false;

  // Scape the phones and write their data.
  log.info(`> Found ${phoneAddresses.length} phone pages. Scrapping phones...`);
  const hasFailed = await scrapPhones(
    { phoneAddresses, pageManager, start },
    options,
  );

  await browser.close();
  return hasFailed;
};

main(program).then(
  failed => {
    process.exit(failed ? 1 : 0);
  },
  e => {
    log.error(e);
    process.exit(1);
  },
);
