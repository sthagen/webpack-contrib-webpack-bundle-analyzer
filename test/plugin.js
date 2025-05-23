const chai = require('chai');
chai.use(require('chai-subset'));
const {expect} = chai;
const fs = require('fs');
const del = require('del');
const path = require('path');
const puppeteer = require('puppeteer');
const BundleAnalyzerPlugin = require('../lib/BundleAnalyzerPlugin');

describe('Plugin', function () {
  describe('options', function () {
    it('should be optional', function () {
      expect(() => new BundleAnalyzerPlugin()).not.to.throw();
    });
  });
});

describe('Plugin', function () {
  let browser;
  jest.setTimeout(15000);

  beforeEach(async function () {
    browser = await puppeteer.launch();
    del.sync(`${__dirname}/output`);
  });

  afterEach(async function () {
    del.sync(`${__dirname}/output`);
    await browser.close();
  });

  forEachWebpackVersion(['4.44.2'], ({it, webpackCompile}) => {
    // Webpack 5 doesn't support `jsonpFunction` option
    it('should support webpack config with custom `jsonpFunction` name', async function () {
      const config = makeWebpackConfig({
        multipleChunks: true
      });

      config.output.jsonpFunction = 'somethingCompletelyDifferent';

      await webpackCompile(config);

      await expectValidReport({
        parsedSize: 1343,
        // On node.js v16 and lower, the calculated gzip is one byte larger. Nice.
        gzipSize:
          parseInt(process.versions.node.split('.')[0]) <= 16 ? 360 : 359
      });
    });
  });

  forEachWebpackVersion(({it, webpackCompile}) => {
    it('should allow to generate json report', async function () {
      const config = makeWebpackConfig({
        analyzerOpts: {
          analyzerMode: 'json'
        }
      });

      await webpackCompile(config);

      const chartData = await getChartDataFromJSONReport();
      expect(chartData).to.exist;
    });

    it('should support webpack config with `multi` module', async function () {
      const config = makeWebpackConfig();

      config.entry.bundle = [
        './src/a.js',
        './src/b.js'
      ];

      await webpackCompile(config);

      const chartData = await getChartDataFromReport();
      const bundleGroup = chartData.find(group => group.label === 'bundle.js');

      expect(bundleGroup.groups)
        .to
        .containSubset([
          {
            label: 'src',
            path: './src',
            groups: [
              {
                label: 'a.js',
                path: './src/a.js'
              },
              {
                label: 'b.js',
                path: './src/b.js'
              }
            ]
          }
        ]);
    });
  });

  describe('options', function () {
    describe('excludeAssets', function () {
      forEachWebpackVersion(({it, webpackCompile}) => {
        it('should filter out assets from the report', async function () {
          const config = makeWebpackConfig({
            multipleChunks: true,
            analyzerOpts: {
              excludeAssets: 'manifest'
            }
          });

          await webpackCompile(config);

          const chartData = await getChartDataFromReport();
          expect(chartData.map(i => i.label))
            .to
            .deep
            .equal(['bundle.js']);
        });
      });
    });

    describe('reportTitle', function () {
      it('should have a sensible default', async function () {
        const config = makeWebpackConfig();
        await webpackCompile(config, '4.44.2');
        const generatedReportTitle = await getTitleFromReport();
        expect(generatedReportTitle).to.match(/^webpack-bundle-analyzer \[.* at \d{2}:\d{2}\]/u);
      });

      it('should support a string value', async function () {
        const reportTitle = 'A string report title';
        const config = makeWebpackConfig({
          analyzerOpts: {
            reportTitle
          }
        });
        await webpackCompile(config, '4.44.2');
        const generatedReportTitle = await getTitleFromReport();
        expect(generatedReportTitle).to.equal(reportTitle);
      });

      it('should support a function value', async function () {
        const reportTitleResult = 'A string report title';
        const config = makeWebpackConfig({
          analyzerOpts: {
            reportTitle: () => reportTitleResult
          }
        });
        await webpackCompile(config, '4.44.2');
        const generatedReportTitle = await getTitleFromReport();
        expect(generatedReportTitle).to.equal(reportTitleResult);
      });

      it('should propagate an error in a function', async function () {
        const reportTitleError = new Error();
        const config = makeWebpackConfig({
          analyzerOpts: {
            reportTitle: () => {throw reportTitleError}
          }
        });

        let error = null;
        try {
          await webpackCompile(config, '4.44.2');
        } catch (e) {
          error = e;
        }

        expect(error).to.equal(reportTitleError);
      });
    });

    describe('compressionAlgorithm', function () {
      it('should default to gzip', async function () {
        const config = makeWebpackConfig({analyzerOpts: {}});
        await webpackCompile(config, '4.44.2');
        await expectValidReport({parsedSize: 1311, gzipSize: 342});
      });

      it('should support gzip', async function () {
        const config = makeWebpackConfig({analyzerOpts: {compressionAlgorithm: 'gzip'}});
        await webpackCompile(config, '4.44.2');
        await expectValidReport({parsedSize: 1311, gzipSize: 342});
      });

      it('should support brotli', async function () {
        const config = makeWebpackConfig({analyzerOpts: {compressionAlgorithm: 'brotli'}});
        await webpackCompile(config, '4.44.2');
        await expectValidReport({parsedSize: 1311, gzipSize: undefined, brotliSize: 302});
      });
    });
  });

  async function expectValidReport(opts) {
    const {
      bundleFilename = 'bundle.js',
      reportFilename = 'report.html',
      bundleLabel = 'bundle.js',
      statSize = 141,
      parsedSize = 2821,
      gzipSize
    } = {gzipSize: 770, ...opts};

    expect(fs.existsSync(`${__dirname}/output/${bundleFilename}`), 'bundle file missing').to.be.true;
    expect(fs.existsSync(`${__dirname}/output/${reportFilename}`), 'report file missing').to.be.true;
    const chartData = await getChartDataFromReport(reportFilename);
    expect(chartData[0]).to.containSubset({
      label: bundleLabel,
      statSize,
      parsedSize,
      gzipSize
    });
  }

  function getChartDataFromJSONReport(reportFilename = 'report.json') {
    return require(path.resolve(__dirname, `output/${reportFilename}`));
  }

  async function getTitleFromReport(reportFilename = 'report.html') {
    const page = await browser.newPage();
    await page.goto(`file://${__dirname}/output/${reportFilename}`);
    return await page.title();
  }

  async function getChartDataFromReport(reportFilename = 'report.html') {
    const page = await browser.newPage();
    await page.goto(`file://${__dirname}/output/${reportFilename}`);
    return await page.evaluate(() => window.chartData);
  }
});
