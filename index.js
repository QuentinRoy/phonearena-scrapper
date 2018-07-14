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
const { retry, getPhoneFileName, download } = require('./modules/utils');

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
  .option('-c, --concurrency <n>', 'Number of parallel scrapping', parseInt, 20)
  .option(
    '--scrapping-retry <n>',
    'Number of time a scrapping should be retried if failed',
    parseInt,
    1,
  )
  .option(
    '--loading-retry <n>',
    'Number of time a page loading should be retried if failed',
    parseInt,
    3,
  )
  .option(
    '--no-headless',
    'If the scrapping should happening without showing the browser',
  )
  .option('-o, --output-dir <path>', 'Output directory', './out')
  .option('-s, --success-only', 'Stop at the first unsuccessful scrapping')
  .option('--no-image-download')
  .parse(process.argv);

const {
  outputDir,
  successOnly,
  update,
  concurrency,
  loadingRetry,
  scrappingRetry,
  headless,
  imageDownload,
} = program;

log.debug({
  outputDir,
  successOnly,
  update,
  concurrency,
  loadingRetry,
  scrappingRetry,
  headless,
  imageDownload,
});

const main = async () => {
  const browser = await puppeteer.launch({ headless });
  const pageManager = PageManager(browser, concurrency, {
    retry: loadingRetry,
  });
  await browser.pages().then(pages => pages.forEach(p => pageManager.give(p)));
  const start = Date.now();
  const retryT = retry(scrappingRetry);

  let failed = false;
  let phonePagesDone = 0;
  let listingPagesDone = 0;
  let doneRecently = 0;

  const speed = () => doneRecently / Math.min(TIME_WINDOW, Date.now() - start);

  // Get all listing pages.
  const allListingPages = await pageManager.withPage(
    LISTING_PAGE_ADDRESS,
    scrapeListingPageAddresses,
  );
  const nListings = allListingPages.length;

  log.info(`> Found ${nListings} list pages. Scrapping phones listings...`);

  // Scrape them all!
  const phoneAddresses = await Promise.all(
    allListingPages.map(
      retryT(() => async addr => {
        const r = await pageManager.withPage(addr, page => {
          log.debug(`> Scrapping listing at ${addr}`);
          return scrapePhoneAddressFromListingPage(page);
        });

        listingPagesDone += 1;
        doneRecently += 1;
        setTimeout(() => {
          doneRecently -= 1;
        }, TIME_WINDOW);
        log.info(
          `${addr} scrapped (${listingPagesDone}/${nListings}, speed: ${Math.round(
            speed() * 60000,
          )}/min, time elapsed: ${moment
            .duration(Date.now() - start)
            .humanize()})`,
        );

        return r;
      }),
    ),
  ).then(addressGroups =>
    addressGroups.reduce((acc, result) => acc.concat(result), []),
  );

  const n = phoneAddresses.length;

  if (!(await exists(outputDir))) {
    await mkdir(outputDir);
  }

  log.info(`> Found ${n} phone pages. Scrapping phones...`);

  await Promise.all(
    phoneAddresses.map(async ({ name, address }) => {
      try {
        const outputFile = path.resolve(
          outputDir,
          getPhoneFileName({ address }),
        );
        if (update !== true && (await exists(outputFile))) {
          let shouldNotUpdate;
          if (update == null) {
            shouldNotUpdate = true;
          } else {
            const lastScrapDate = JSON.parse(await readFile(outputFile))
              .scrapDate;
            shouldNotUpdate = moment(lastScrapDate).diff(update) >= 0;
          }
          if (shouldNotUpdate) {
            phonePagesDone += 1;
            log.debug(`> Not updating ${name}`);
            return;
          }
        }
        const phoneData = await retryT(() =>
          pageManager
            .withPage(address, page => {
              log.debug(`> Scrapping phone "${name}"...`);
              return scrapePhonePage(page);
            })
            .then(res => ({
              ...res,
              address,
              scrapDate: new Date().toISOString(),
              scrapper: `${scrapperName} v${version}`,
            })),
        );

        // Download the image.
        if (imageDownload && phoneData.image) {
          const imageExt = path.extname(/^[^(?|#)]+/.exec(phoneData.image)[0]);
          const outputFileBaseName = path.basename(
            outputFile,
            path.extname(outputFile),
          );
          await download(
            phoneData.image,
            path.resolve(
              path.dirname(outputFile),
              outputFileBaseName + imageExt,
            ),
          );
        }
        // Write the file.
        await writeFile(outputFile, JSON.stringify(phoneData, null, 2));

        phonePagesDone += 1;
        doneRecently += 1;
        setTimeout(() => {
          doneRecently -= 1;
        }, TIME_WINDOW);
        const eta = (n - phonePagesDone) / speed();
        log.info(
          `"${name}" scrapped (${phonePagesDone}/${n}, speed: ${Math.round(
            speed() * 60000,
          )}/min, time elapsed: ${moment
            .duration(Date.now() - start)
            .humanize()}, ETA: ${moment.duration(eta).humanize()})`,
        );
      } catch (e) {
        failed = true;
        log.error(`Failed while scrapping ${name} at ${address}`);
        if (successOnly) throw e;
        else log.error(e);
      }
    }),
  );

  await browser.close();

  return failed;
};

main().then(
  failed => {
    process.exit(failed ? 1 : 0);
  },
  e => {
    log.error(e);
    process.exit(1);
  },
);
