const scrapeListingPageAddresses = async page => {
  await new Promise(resolve => setTimeout(resolve, 3000));
  const lastListingPage = await page.$eval(
    '#phones .s_pager .s_last a',
    last => last.href,
  );
  const listingPageNumberRE = /\/(\d+)$/;
  const listingPageNumberMatch = listingPageNumberRE.exec(lastListingPage);
  if (listingPageNumberMatch == null) {
    throw new Error("Could not find last page's number");
  }
  const listingPageNumber = +listingPageNumberMatch[1];
  if (Number.isNaN(listingPageNumber)) {
    throw new Error("Could not parse the number last page's number");
  }
  return Array.from({ length: listingPageNumber }).map((_, i) =>
    lastListingPage.replace(listingPageNumberRE, `/${i + 1}`),
  );
};

const scrapePhoneAddressFromListingPage = page =>
  page.$eval('body', body =>
    Array.from(
      body.querySelectorAll('#phones .s_listing .s_block_4 h3 > a'),
    ).map(a => ({ address: a.href, name: a.text })),
  );

module.exports = {
  scrapeListingPageAddresses,
  scrapePhoneAddressFromListingPage,
};
