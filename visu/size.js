/* globals d3, moment, _, noUiSlider */

const CONFIG = {
  phoneDataAddress: './phones.csv',
  margin: { top: 20, right: 20, bottom: 30, left: 40 },
  diagonalElement: '#histogram-diagonal',
  heightElement: '#histogram-height',
  widthElement: '#histogram-width',
  maxPhoneAge: 3,
  includedManufacturers: 'all', // ['apple', 'samsung', 'huawei', 'xiaomi', 'oppo'],
};

const toDecimalYearFormat = momentDate =>
  momentDate.year() + momentDate.month() / 12;

const makeHistogram = initOptions => {
  const { svg } = initOptions;
  const width = +svg.attr('width');
  const height = +svg.attr('height');

  const barGroup = svg.append('g').attr('class', 'bars');
  const xAxisElement = svg.append('g');
  const yAxisNode = svg.append('g');

  const tip = d3
    .tip()
    .attr('class', 'd3-tip')
    .html(d => `${d.brand} ${d.name}`)
    .direction('e');

  svg.call(tip);

  // prettier-ignore
  const update = (newOptions) => {
    const { data, margin, getter } = { ...initOptions, ...newOptions }
    const x = d3.scaleLinear()
      .domain(d3.extent(data, getter)).nice()
      .range([margin.left, width - margin.right]);

    const bins = d3.histogram()
      .domain(x.domain())
      .value(getter)
      .thresholds(d3.thresholdFreedmanDiaconis)(data);

    const y = d3.scaleLinear()
      .domain([0, d3.max(bins, d => d.length)]).nice()
      .range([height - margin.bottom, margin.top]);

      const xAxis = g =>
        g.attr('transform', `translate(0,${height - margin.bottom})`).call(
          d3
            .axisBottom(x)
            .tickSizeOuter(0)
            .tickFormat(d => `${d3.format('.3s')(d / 1000)}m`),
        );

    const yAxis = g => g
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y))
        .call(g_ => g_.select('.domain').remove());

    const bars = barGroup.selectAll('.bar')
        .data(bins, d => `${d.x0}-${d.x1}`);
    
    bars.exit().remove();

    const barsEnter = bars.enter().append('g')
        .attr('class', 'bar');

    barsEnter
      .append('rect')
        .attr('class', 'area')
        .attr('fill', 'steelblue');
      
    barsEnter.merge(bars)
        .attr('transform', d => `translate(${x(d.x0) + 1}, ${y(d.length)})`)
      .select('.area')
        .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 1))
        .attr('height', d => y(0) - y(d.length));

    const phones = barsEnter.merge(bars).selectAll('.phone')
        .data(dParent => dParent.map(d => ({
          ...d,
          width: Math.max(0, x(dParent.x1) - x(dParent.x0) - 1)
        })), d => d.id);
    phones.exit().remove();

    const phonesEnter = phones.enter().append('a')
        .attr('class', 'phone')
        .attr('xlink:href', d => d.address);
    phonesEnter
      .append('rect')
        .attr('fill', '#84B2E0')
        .style('opacity', 0)
        .style('cursor', 'pointer')
        .on('mouseover', function (...args) {
          d3.select(this).style('opacity', 1);
          tip.show.apply(this, args);
        })
        .on('mouseout', function (...args) {
          d3.select(this).style('opacity', 0);
          tip.hide.apply(this, args);
        });
    phonesEnter.merge(phones).select('rect')
        .attr('height', (d, i) => y(i) - y(i+1))
        .attr('y', (d, i) => y(0) - y(i))
        .attr('width', d => d.width);

    xAxisElement.call(xAxis);
    yAxisNode.call(yAxis);
  }
  update(initOptions);
  return update;
};

const main = async ({
  margin,
  phoneDataAddress,
  diagonalElement,
  heightElement,
  widthElement,
  includedManufacturers,
}) => {
  const rawData = await d3.dsv(',', phoneDataAddress);

  const data = _.sortBy(
    rawData
      .filter(
        d =>
          d.parsedReleaseDate &&
          d.dimensions &&
          d.deviceType &&
          d.deviceType.toLowerCase().replace(' ', '') === 'smartphone' &&
          (includedManufacturers === 'all' ||
            includedManufacturers.includes(d.brand.toLowerCase())),
      )
      .map(d => {
        const momentReleaseDate = moment(d.parsedReleaseDate);
        const jsReleaseDate = momentReleaseDate.toDate();
        const diagonal = Math.sqrt(d.parsedWidth ** 2 + d.parsedHeight ** 2);
        return { ...d, momentReleaseDate, jsReleaseDate, diagonal };
      }),
    a => [a.brand.toLowerCase(), a.name.toLowerCase()],
  );

  const years = data.map(d => toDecimalYearFormat(d.momentReleaseDate));

  const slider = noUiSlider.create(document.getElementById('slider'), {
    start: [
      toDecimalYearFormat(moment().subtract(3, 'year')),
      toDecimalYearFormat(moment()),
    ],
    connect: true,
    behaviour: 'drag',
    range: {
      min: Math.min(...years),
      max: Math.max(...years),
    },
  });

  const getSliderValues = () => {
    const [minYear, maxYear] = slider.get().map(x => Math.round(x * 10) / 10);
    return {
      min: {
        year: Math.floor(minYear),
        month: Math.round((minYear % 1) * 12),
      },
      max: {
        year: Math.floor(maxYear),
        month: Math.round((maxYear % 1) * 12),
      },
    };
  };

  const sliderValues = getSliderValues();

  const filteredData = data.filter(
    d =>
      d.momentReleaseDate > moment(sliderValues.min) &&
      d.momentReleaseDate < moment(sliderValues.max),
  );

  const histograms = {
    diagonal: makeHistogram({
      data: filteredData,
      margin,
      svg: d3.select(diagonalElement),
      getter: d => d.diagonal,
    }),
    width: makeHistogram({
      data: filteredData,
      margin,
      svg: d3.select(widthElement),
      getter: d => +d.parsedWidth,
    }),
    height: makeHistogram({
      data: filteredData,
      margin,
      svg: d3.select(heightElement),
      getter: d => +d.parsedHeight,
    }),
  };

  let lastSliderValues = sliderValues;

  const titleDates = [...document.querySelectorAll('.date-range')];
  const updateTitlesDate = (newSliderValues = getSliderValues()) => {
    const min = moment(newSliderValues.min);
    const max = moment(newSliderValues.max);
    const text = `(${min.format('MMM YYYY')} to ${max.format('MMM YYYY')})`;
    titleDates.forEach(elt => {
      elt.innerHTML = text; // eslint-disable-line no-param-reassign
    });
  };

  updateTitlesDate(sliderValues);

  slider.on(
    'update',
    _.throttle(() => {
      const newSliderValues = getSliderValues();
      if (_.isEqual(newSliderValues, lastSliderValues)) return;
      updateTitlesDate(newSliderValues);
      lastSliderValues = newSliderValues;
      const newData = data.filter(
        d =>
          d.momentReleaseDate > moment(newSliderValues.min) &&
          d.momentReleaseDate < moment(newSliderValues.max),
      );
      Object.values(histograms).forEach(histo => histo({ data: newData }));
    }, 100),
  );
};

main(CONFIG).catch(console.error);
