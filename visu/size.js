/* globals d3, moment, _, noUiSlider */

const CONFIG = {
  phoneDataAddress: './phones.csv',
  margin: { top: 20, right: 20, bottom: 20, left: 20 },
  percentilePlotHeight: 8,
  plotsMargin: 30,
  diagonalElement: '#histogram-diagonal',
  heightElement: '#histogram-height',
  widthElement: '#histogram-width',
  ratioHeightWidthElement: '#histogram-ratio-height-width',
  maxPhoneAge: 3,
  includedManufacturers: 'all', // ['apple', 'samsung', 'huawei', 'xiaomi', 'oppo'],
  barColor: 'steelblue',
  phoneHoverColor: '#84B2E0',
  barLabelColor: '#326FAB',
  percentileLabelColor: 'black',
  percentileBoxColor: '#DEEEFF',
  lowerPercentile: 0.05,
  upperPercentile: 0.95,
};

const toDecimalYearFormat = momentDate =>
  momentDate.year() + momentDate.month() / 12;

const makeHistogram = initOptions => {
  const { svg } = initOptions;
  const width = +svg.attr('width');
  const height = +svg.attr('height');

  const tip = d3
    .tip()
    .attr('class', 'd3-tip')
    .html(
      d => `
        <h3>${d.brand} ${d.name}</h3>
        <p>${d.parsedWidth} x ${d.parsedHeight} x ${d.parsedThickness}mm</p>
      `,
    )
    .direction('e');
  svg.call(tip);

  const barGroup = svg.append('g').attr('class', 'bars');
  const xAxisGroup = svg.append('g').attr('class', 'x-axis');
  const percentilePlotGroup = svg
    .append('g')
    .attr('class', 'precentile')
    .style('font-size', 10);

  // Init the percentile plot.
  const quartileBox = percentilePlotGroup
    .append('rect')
    .attr('class', 'percentileBox')
    .style('stroke', 'black')
    .style('stroke-width', 1);
  const lowerPercentileLine = percentilePlotGroup
    .append('line')
    .attr('class', 'lower-percentile-line')
    .style('stroke', 'black')
    .style('stroke-width', 1);
  const upperPercentileLine = percentilePlotGroup
    .append('line')
    .attr('class', 'upper-percentile-line')
    .style('stroke', 'black')
    .style('stroke-width', 1);
  const leftPercentileJoin = percentilePlotGroup
    .append('line')
    .attr('class', 'left-percentile-join')
    .style('stroke', 'black')
    .style('stroke-width', 1);
  const rightPercentileJoin = percentilePlotGroup
    .append('line')
    .attr('class', 'right-percentile-join')
    .style('stroke', 'black')
    .style('stroke-width', 1);
  const medianLine = percentilePlotGroup
    .append('line')
    .attr('class', 'median')
    .style('stroke', 'black')
    .style('stroke-width', 2);
  const lowerQuartileLabel = percentilePlotGroup
    .append('text')
    .classed('lower-quartile-label', true)
    .attr('alignment-baseline', 'hanging')
    .attr('text-anchor', 'middle');
  const upperQuartileLabel = percentilePlotGroup
    .append('text')
    .classed('upper-quartile-label', true)
    .attr('alignment-baseline', 'hanging')
    .attr('text-anchor', 'middle');
  const lowerPercentileLabel = percentilePlotGroup
    .append('text')
    .classed('lower-percentile-label', true)
    .attr('alignment-baseline', 'hanging')
    .attr('text-anchor', 'middle');
  const upperPercentileLabel = percentilePlotGroup
    .append('text')
    .classed('upper-percentile-label', true)
    .attr('alignment-baseline', 'hanging')
    .attr('text-anchor', 'middle');
  const medianLabel = percentilePlotGroup
    .append('text')
    .classed('median-label', true)
    .attr('alignment-baseline', 'hanging')
    .attr('text-anchor', 'middle');

  // prettier-ignore
  const update = newOptions => {
    const {
      data,
      margin,
      getter,
      barColor,
      phoneHoverColor,
      barLabelColor,
      percentilePlotHeight,
      percentileLabelColor,
      plotsMargin,
      percentileBoxColor,
      lowerPercentile: lowerPercentileP,
      upperPercentile: upperPercentileP,
      labelFormat,
    } = { ...initOptions, ...newOptions }

    const x = d3.scaleLinear()
      .domain(d3.extent(data, getter)).nice()
      .range([margin.left, width - margin.right]);

    const bins = d3.histogram()
      .domain(x.domain())
      .value(getter)
      .thresholds(d3.thresholdFreedmanDiaconis)(data);

    const y = d3.scaleLinear()
      .domain([0, d3.max(bins, d => d.length)]).nice()
      .range([
        height - margin.bottom - percentilePlotHeight - plotsMargin,
        margin.top
      ]);

    const xAxis = g =>
      g.attr(
        'transform',
        `translate(0,${
          height - margin.bottom - percentilePlotHeight - plotsMargin
        })`
      ).call(
        d3
          .axisBottom(x)
          .tickSizeOuter(0)
          .tickFormat(labelFormat),
      );

    const bars = barGroup.selectAll('.bar')
        .data(bins, d => `${d.x0}-${d.x1}`);
    
    bars.exit().remove();

    const barsEnter = bars.enter().append('g')
        .attr('class', 'bar');

    barsEnter
      .append('rect')
        .attr('class', 'area')
        .attr('fill', barColor);

    barsEnter
      .append('text')
        .attr('class', 'label-count')
        .attr('text-anchor', 'middle')
        .attr('y', -2)
        .style('font-size', 10)
        .style('fill', barLabelColor);
      
    const barsEnterUpdate = barsEnter.merge(bars)
        .attr('transform', d => `translate(${x(d.x0) + 1}, ${y(d.length)})`);
    barsEnterUpdate    
      .select('.area')
        .attr('width', d => Math.max(0, x(d.x1) - x(d.x0) - 1))
        .attr('height', d => y(0) - y(d.length));
    barsEnterUpdate
      .select('.label-count')
        .text(d => d.length > 0 ? d.length : '')
        .attr('x', d => Math.max(0, x(d.x1) - x(d.x0) - 1) / 2)

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
        .attr('fill', phoneHoverColor)
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

    xAxisGroup.call(xAxis);

    const sortedValues = data.sort((a, b) => getter(a) - getter(b));
    // Make percentile plot now.
    const lowerPercentileValue = d3.quantile(sortedValues, lowerPercentileP, getter);
    const upperPercentileValue = d3.quantile(sortedValues, upperPercentileP, getter);
    const lowerQuartileValue = d3.quantile(sortedValues, .25, getter);
    const upperQuartileValue = d3.quantile(sortedValues, .75, getter);
    const medianValue = d3.quantile(sortedValues, .5, getter);

    percentilePlotGroup
      .attr(
        'transform',
        `translate(0,${
          height - margin.bottom - percentilePlotHeight
        })`
      );
    quartileBox
      .attr('x', x(lowerQuartileValue))
      .attr('width', x(upperQuartileValue) - x(lowerQuartileValue))
      .attr('y', 0)
      .attr('height', percentilePlotHeight)
      .style('fill', percentileBoxColor);
    medianLine
      .attr('x1', x(medianValue))
      .attr('x2', x(medianValue))
      .attr('y1', 0)
      .attr('y2', percentilePlotHeight);
    lowerQuartileLabel
      .attr('x', x(lowerQuartileValue))
      .attr('y', percentilePlotHeight + 2)
      .text(labelFormat(lowerQuartileValue))
      .attr('fill', percentileLabelColor);
    upperQuartileLabel
      .attr('x', x(upperQuartileValue))
      .attr('y', percentilePlotHeight + 2)
      .text(labelFormat(upperQuartileValue))
      .attr('fill', percentileLabelColor);
    medianLabel
      .attr('x', x(medianValue))
      .attr('y', percentilePlotHeight + 2)
      .text(labelFormat(medianValue))
      .attr('fill', percentileLabelColor);
    lowerPercentileLine
      .attr('x1', x(lowerPercentileValue))
      .attr('x2', x(lowerPercentileValue))
      .attr('y1', 0)
      .attr('y2', percentilePlotHeight);
    lowerPercentileLabel
      .attr('x', x(lowerPercentileValue))
      .attr('y', percentilePlotHeight + 2)
      .text(labelFormat(lowerPercentileValue))
      .attr('fill', percentileLabelColor);
    upperPercentileLine
      .attr('x1', x(upperPercentileValue))
      .attr('x2', x(upperPercentileValue))
      .attr('y1', 0)
      .attr('y2', percentilePlotHeight);
    upperPercentileLabel
      .attr('x', x(upperPercentileValue))
      .attr('y', percentilePlotHeight + 2)
      .text(labelFormat(upperPercentileValue))
      .attr('fill', percentileLabelColor);
    leftPercentileJoin
      .attr('x1', x(lowerPercentileValue))
      .attr('x2', x(lowerQuartileValue))
      .attr('y1', percentilePlotHeight / 2)
      .attr('y2', percentilePlotHeight / 2);
    rightPercentileJoin
      .attr('x1', x(upperPercentileValue))
      .attr('x2', x(upperQuartileValue))
      .attr('y1', percentilePlotHeight / 2)
      .attr('y2', percentilePlotHeight / 2);
  }
  update(initOptions);
  return update;
};

const main = async options => {
  const {
    phoneDataAddress,
    diagonalElement,
    heightElement,
    widthElement,
    ratioHeightWidthElement,
    includedManufacturers,
  } = options;
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
      ...options,
      data: filteredData,
      svg: d3.select(diagonalElement),
      getter: d => d.diagonal,
      labelFormat: d => `${d3.format('.3s')(d / 1000)}m`,
    }),
    width: makeHistogram({
      ...options,
      data: filteredData,
      svg: d3.select(widthElement),
      getter: d => +d.parsedWidth,
      labelFormat: d => `${d3.format('.3s')(d / 1000)}m`,
    }),
    height: makeHistogram({
      ...options,
      data: filteredData,
      svg: d3.select(heightElement),
      getter: d => +d.parsedHeight,
      labelFormat: d => `${d3.format('.3s')(d / 1000)}m`,
      unit: 'm',
    }),
    ratioHeightWidth: makeHistogram({
      ...options,
      data: filteredData,
      svg: d3.select(ratioHeightWidthElement),
      getter: d => +d.parsedHeight / +d.parsedWidth,
      labelFormat: x => d3.format('.3')(x),
    }),
  };

  let lastSliderValues = sliderValues;

  const titleDates = [...document.querySelectorAll('.date-range')];
  const phoneCounts = [...document.querySelectorAll('.phone-count')];
  const updateLegend = (newSliderValues, phoneCount) => {
    const min = moment(newSliderValues.min);
    const max = moment(newSliderValues.max);
    const text = `${min.format('MMM YYYY')} to ${max.format('MMM YYYY')}`;
    titleDates.forEach(elt => {
      elt.innerHTML = text; // eslint-disable-line no-param-reassign
    });
    phoneCounts.forEach(elt => {
      elt.innerHTML = phoneCount; // eslint-disable-line no-param-reassign
    });
  };

  updateLegend(sliderValues, filteredData.length);

  document.body.classList.remove('loading');

  slider.on(
    'update',
    _.throttle(() => {
      const newSliderValues = getSliderValues();
      if (_.isEqual(newSliderValues, lastSliderValues)) return;
      lastSliderValues = newSliderValues;
      const newData = data.filter(
        d =>
          d.momentReleaseDate > moment(newSliderValues.min) &&
          d.momentReleaseDate < moment(newSliderValues.max),
      );
      updateLegend(newSliderValues, newData.length);
      Object.values(histograms).forEach(histo => histo({ data: newData }));
    }, 100),
  );
};

main(CONFIG).catch(console.error);
