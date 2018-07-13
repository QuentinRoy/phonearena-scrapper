const memoize = require('memize');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const log = require('loglevel');
const { retry } = require('./utils');

const pageManagerLog = log.getLogger('PageManager');

const getBlackList = memoize(
  blackListFilePath =>
    new Promise((resolve, reject) => {
      const hostRE = /^\s*0\.0\.0\.0\s+(?:www\.)?(\S+)\s*$/g;
      const hosts = new Set();
      const lineReader = readline.createInterface({
        input: fs.createReadStream(blackListFilePath),
      });
      lineReader.on('line', line => {
        const match = hostRE.exec(line);
        if (match) {
          hosts.add(match[1]);
        }
      });
      lineReader.on('error', err => reject(err));
      lineReader.on('close', () => resolve(hosts));
    }),
);

const PageManager = (
  browser,
  concurrency,
  {
    gotoOpts = {
      waitUntil: 'domcontentloaded',
      timeout: 2 * 60 * 1000,
    },
    blackListPath = path.resolve(__dirname, '../social-and-ads-hosts.txt'),
    forbiddenResourceType: forbiddenResourceType_ = [
      'image',
      'font',
      'media',
      'stylesheet',
      'script',
    ],
    retry: retryNb = 0,
  } = {},
) => {
  const forbiddenResourceType = new Set(forbiddenResourceType_);
  const blackListProm = blackListPath
    ? getBlackList(blackListPath).then(bl => ({
        // The set can be huge, but in practice we'll probably only look for
        // a few elements. Cache these elements in a smaller set so that
        // we avoid looking in the big most of the time.
        has: memoize((...args) => bl.has(...args)),
      }))
    : Promise.resolve({ had: () => false });

  const availablePages = [];
  const waitingList = [];
  let busyPages = 0;

  const openNewPage = async () => {
    const [blackList, page] = [await blackListProm, await browser.newPage()];
    await page.setRequestInterception(true);

    // Block blacklisted domains
    page.on('request', request => {
      const url = request.url();
      const domain = url.match(
        /^(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-_.]+)/,
      )[1];
      if (
        forbiddenResourceType.has(request.resourceType()) ||
        !!url.match(/^[^(?|#)]+\.(png|jpe?g|gif)((\?|#).*)?$/) ||
        (domain && blackList.has(domain))
      ) {
        request.abort();
      } else {
        request.continue();
      }
    });
    return page;
  };

  const take = async address => {
    let page;
    if (availablePages.length > 0) {
      busyPages += 1;
      page = availablePages.shift();
    } else if (busyPages < concurrency) {
      busyPages += 1;
      page = await openNewPage();
      pageManagerLog.debug('New page opened.');
    } else {
      page = await new Promise(resolve => {
        waitingList.push(resolve);
      });
    }
    if (address) {
      try {
        // Try to navigate to target address.
        await page.goto(address, gotoOpts);
      } catch (e) {
        if (retry <= 0) {
          throw e;
        } else {
          // If it failed, try to reload.
          await retry(retryNb - 1)(async () => {
            pageManagerLog.debug(
              `Page loading failed... Retrying. (${address})`,
            );
            await page.close();
            page = await openNewPage();
            await page.goto(address, gotoOpts);
          });
        }
      }
    }
    return page;
  };

  const give = async page => {
    const futureBusyPages = Math.max(0, busyPages - 1);
    if (availablePages.length + futureBusyPages >= concurrency) {
      busyPages = futureBusyPages;
      await page.close();
      pageManagerLog.debug('Extra page closed.');
    } else if (waitingList.length) {
      waitingList.shift()(page);
    } else {
      busyPages = futureBusyPages;
      availablePages.push(page);
    }
  };

  const withPage = (address, f) => {
    let page;
    return take(address)
      .then(page_ => {
        page = page_;
        return f(page);
      })
      .finally(() => give(page));
  };

  return { take, give, withPage };
};

module.exports = PageManager;
