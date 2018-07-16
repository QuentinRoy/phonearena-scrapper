const scrapePhonePage = page =>
  page.$eval('#content', async contentDiv => {
    const phoneDiv = contentDiv.querySelector('#phone');

    // Take a string and remove its parenthesis
    const removeParenthesis = (string, max = Number.POSITIVE_INFINITY) =>
      max > 0 && string.startsWith('(') && string.endsWith(')')
        ? removeParenthesis(string.slice(1, -1).trim(), max - 1)
        : string;

    // Parse quickLook features.
    const mapFeature = args => elt => ({
      name: elt.textContent,
      ...args,
    });
    const quickLookFeatures = [
      ...[...phoneDiv.querySelectorAll('.quicklook .features .inactive')].map(
        mapFeature({ active: false }),
      ),
      ...[...phoneDiv.querySelectorAll('.quicklook .features .active')].map(
        mapFeature({ active: true }),
      ),
    ].reduce(
      (obj, feat) => ({ ...obj, [feat.name.replace(/\*$/, '')]: feat.active }),
      {},
    );

    // Parse quicklook metainfo.
    const metaInfo = Array.from(
      phoneDiv.querySelector('.quicklook .metainfo').childNodes,
    )
      .reduce(
        (infos, n) =>
          n.tagName === 'BR'
            ? [...infos, '']
            : [
                ...infos.slice(0, -1),
                `${infos[infos.length - 1]}${
                  n.nodeName === '#comment' ? '' : n.textContent
                }`,
              ],
        [''],
      )
      .map(l => l.trim())
      .filter(l => l)
      .map(l => l.split(':'))
      .map(([name, value]) => ({ name, value: value.trim() }));

    // Parse specs
    const scapeSpecItemName = itemElt => {
      let titleElt = itemElt.querySelector(':scope > strong');
      if (!titleElt) return undefined;
      titleElt = titleElt.querySelector('.s_tooltip_anchor') || titleElt;
      let name = titleElt.textContent;
      name = name.trim();
      if (name.endsWith(':')) name = name.slice(0, -1);
      return name;
    };

    const scrapeSpecItemValue = elt => {
      const firstLi = elt.querySelector(':scope > ul > li:first-child');
      if (!firstLi || firstLi.classList.contains('clear')) return undefined;
      const valueElt = firstLi.querySelector('ul li') || firstLi;
      const valueEltText = [...valueElt.childNodes].find(
        n => n.nodeType === 3 && n.textContent.trim(),
      );
      if (valueEltText) return valueEltText.textContent.trim();
      return undefined;
    };

    const scapeSpecSubItem = (subItemElt, defaultName = 'value') => {
      const n = scapeSpecItemName(subItemElt);
      const name = !n ? defaultName : n;
      const value = scrapeSpecItemValue(subItemElt);
      return { name, value };
    };

    const scrapeSpecItem = itemElt => {
      const name = scapeSpecItemName(itemElt);
      const value = scrapeSpecItemValue(itemElt);
      const subItems = Array.from(
        itemElt.querySelectorAll(':scope > ul > li.clear'),
      ).map(item => scapeSpecSubItem(item));
      return {
        name,
        value,
        ...(subItems.length ? { items: subItems } : {}),
      };
    };

    const specBoxes = [
      ...phoneDiv.querySelectorAll('#phone_specificatons .s_specs_box'),
    ];
    const specs = specBoxes.map(elt => {
      const name = elt.querySelector('.htitle').textContent;
      const specItems = Array.from(elt.querySelectorAll(':scope > ul > li'))
        .map(scrapeSpecItem)
        // Filters item that have no values and no subitems.
        .filter(({ value, items }) => value != null || items != null);

      return { name, ...(specItems.length ? { items: specItems } : {}) };
    });

    // Scrape brand, name, type
    const navMatch = contentDiv
      .querySelector('.s_breadcrumbs li:first-child + li + .s_sep + li a')
      .href.match(/\/manufacturers\/([^/]+)(?:\/(\w+))?$/);
    const brand = navMatch[1].trim();
    const type = (navMatch[2] || 'phone').trim().replace(/(s)$/, '');
    const name = phoneDiv
      .querySelector('h1 > span')
      .textContent.replace(brand, '')
      .trim();

    // Scrape rating
    const ratings = Array.from(phoneDiv.querySelectorAll('.rating')).map(e => [
      e.querySelector('.whosrating').textContent.replace(/(Rating:?)$/g, ''),
      +e.querySelector('.s_rating_overal').textContent,
    ]);

    // Scrape description
    const descriptionElt = phoneDiv.querySelector('.desc');
    const description = descriptionElt
      ? descriptionElt.textContent.trim()
      : undefined;

    // Scrape variants.
    const variants = Array.from(
      phoneDiv.querySelectorAll('.variants > div'),
    ).map(elt => {
      const variantCommentElt = elt.querySelector('.h-title .variant-comment');
      const dirtyVariantComment = variantCommentElt
        ? variantCommentElt.textContent.trim()
        : undefined;
      const variantName = elt
        .querySelector('.h-title')
        .textContent.replace(dirtyVariantComment || '', '')
        .trim();
      const variantComment =
        dirtyVariantComment && removeParenthesis(dirtyVariantComment);
      const variantDescriptionElt = elt.querySelector('.description');
      const variantDescription = variantDescriptionElt
        ? variantDescriptionElt.textContent.trim()
        : undefined;
      const variantSpecs = Array.from(
        elt.querySelectorAll('.s_specs_box > ul > li'),
      ).map(scrapeSpecItem);
      return {
        name: variantName,
        comment: variantComment,
        ...(variantDescription ? { description: variantDescription } : {}),
        specs: variantSpecs,
      };
    });

    // Scrape image address
    const image = phoneDiv.querySelector('.quicklook .lead').href;

    return {
      name,
      brand,
      type,
      ...(image && /(https?:\/\/.*\.(?:png|jpe?g|gif))/i.exec(image)
        ? { image }
        : {}),
      metaInfo,
      features: quickLookFeatures,
      specs,
      ratings,
      ...(description ? { description } : {}),
      variants,
    };
  });

module.exports = scrapePhonePage;
