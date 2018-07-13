const memoize = require('memize');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const log = require('loglevel');

const pageManagerLog = log.getLogger('PageManager');

const retry = n => f => {
  // Set up end of recursion.
  if (n <= 0) return f();
  try {
    const r = f();
    // Recognize promises and manage asynchronous errors and success.
    if (typeof r.then === 'function') {
      return r.then(x => x, () => retry(n - 1)(f));
    }
    // Manage synchronous success.
    return r;
  } catch (e) {
    // Manage synchronous errors.
    return retry(n - 1)(f);
  }
};

const getBlackList = memoize(
  (
    blackListFilePath = path.resolve(__dirname, '../social-and-ads-hosts.txt'),
  ) =>
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
    retry: retryNb = 0,
  } = {},
) => {
  const blackListProm = getBlackList().then(bl => ({
    // The set is huge, but in practice we'll probably only lookup a few elements.
    // Cache these elements.
    has: memoize((...args) => bl.has(...args)),
  }));

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
      const isImage = !!url.match(/^[^(?|#)]+\.(png|jpe?g|gif)((\?|#).*)?$/);
      if (isImage || (domain && blackList.has(domain))) {
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

const withPage = async (pageManager, address, f) => {
  const page = await pageManager.take();
  await page.goto(address, {
    waitUntil: 'domcontentloaded',
    timeout: 2 * 60 * 1000,
  });
  const result = await f(page);
  await pageManager.give();
  return result;
};

const withPageDecorator = f => (...args) => withPage(...args, f);

const pagePeak = (browser, address, selector, pageFunction) =>
  withPage(browser, address, page => page.$eval(selector, pageFunction));

const pagePeakDecorator = (selector, f) => (...args) =>
  pagePeak(...args, selector, f);

module.exports = {
  PageManager,
  retry,
  withPage,
  withPageDecorator,
  pagePeak,
  pagePeakDecorator,
};
