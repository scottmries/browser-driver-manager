const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const path = require('path');
const fsPromises = require('fs').promises;
const os = require('os');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const expect = chai.expect;
chai.use(chaiAsPromised);

const originalProcessStdoutWrite = process.stdout.write;

const mockProcessStdoutWrite = sinon.stub();
const mockConsoleLog = sinon.stub(console, 'log');

const mockVersion = '126.0.6442.0';
const MOCK_HOME_DIR = './mock-user-home-dir';
const MOCK_BDM_CACHE_DIR = path.resolve(
  MOCK_HOME_DIR,
  '.browser-driver-manager'
);
const envPath = path.resolve(MOCK_BDM_CACHE_DIR, '.env');
const chromeTestPath = `${MOCK_BDM_CACHE_DIR}/chrome/os_arch-${mockVersion}/chrome`;
const chromedriverTestPath = `${MOCK_BDM_CACHE_DIR}/chromedriver/os_arch-${mockVersion}/chromedriver`;
const envContents = `CHROME_TEST_PATH="${chromeTestPath}"${os.EOL}CHROMEDRIVER_TEST_PATH="${chromedriverTestPath}"${os.EOL}VERSION="${mockVersion}"`;

const mockResolveBuildId = sinon.stub();
const mockDetectBrowserPlatform = sinon.stub();
const mockInstall = sinon.stub();
const mockBrowser = {
  CHROME: 'chrome',
  CHROMEDRIVER: 'chromedriver'
};
const puppeteerBrowserMocks = {
  detectBrowserPlatform: mockDetectBrowserPlatform,
  install: mockInstall,
  Browser: mockBrowser,
  resolveBuildId: mockResolveBuildId
};

let browser;

const { install, version, which } = proxyquire(
  '../src/browser-driver-manager',
  {
    '@puppeteer/browsers': puppeteerBrowserMocks,
    os: {
      homedir: sinon.stub().returns(MOCK_HOME_DIR)
    }
  }
);

beforeEach(async () => {
  browser = 'chrome';

  mockDetectBrowserPlatform.returns('mac');
  mockInstall.returns({ executablePath: chromeTestPath });
  mockResolveBuildId.returns(mockVersion);

  try {
    await fsPromises.rm(MOCK_HOME_DIR, { recursive: true });
  } catch (e) {}
});

afterEach(() => {
  sinon.reset();
});

const makeEnvFile = async (contents = envContents) => {
  await fsPromises.mkdir(MOCK_BDM_CACHE_DIR, { recursive: true });
  await fsPromises.writeFile(envPath, contents);
};

describe('browser-driver-manager', () => {
  describe('which', () => {
    it('should log the locations of chrome and chromedriver if they exist', async () => {
      await makeEnvFile();
      await which();

      sinon.assert.calledWith(mockConsoleLog, envContents);
    });
    it('should error if no environment file exists', async () => {
      await expect(which()).to.be.rejectedWith(
        'No environment file exists. Please install first'
      );
    });
  });
  describe('version', () => {
    it('should log the version when a valid one exists', async () => {
      await makeEnvFile();
      await version();

      sinon.assert.calledWith(mockConsoleLog, mockVersion);
    });
    it('should error if no environment file exists', async () => {
      await expect(which()).to.be.rejectedWith(
        'No environment file exists. Please install first'
      );
    });
  });
  describe('install', () => {
    it('should error if an unsupported browser is given', async () => {
      await expect(install('firefox')).to.be.rejectedWith(
        'The selected browser, firefox, could not be installed. Currently, only "chrome" is supported.'
      );
    });
    it("should create the cache directory if it doesn't already exist", async () => {
      await install(browser);
      await expect(fsPromises.access(MOCK_BDM_CACHE_DIR)).to.be.fulfilled;
    });

    it("should error if the platform couldn't be detected", async () => {
      mockDetectBrowserPlatform.returns(undefined);
      await expect(install(browser)).to.be.rejectedWith(
        'Unable to detect browser platform'
      );
    });

    it('creates the environment file when a valid version is given', async () => {
      mockInstall
        .withArgs(
          sinon.match({
            cacheDir: sinon.match.string,
            browser: 'chrome',
            buildId: sinon.match.string
          })
        )
        .returns({ executablePath: chromeTestPath });

      mockInstall
        .withArgs(
          sinon.match({
            cacheDir: sinon.match.string,
            browser: 'chromedriver',
            buildId: sinon.match.string
          })
        )
        .returns({ executablePath: chromedriverTestPath });

      await install('chrome@latest');

      sinon.assert.calledWith(
        mockConsoleLog,
        'Setting env CHROME/CHROMEDRIVER_TEST_PATH/VERSION'
      );
      await expect(fsPromises.readFile(envPath, 'utf-8')).to.be.fulfilled;
      const env = await fsPromises.readFile(envPath, 'utf-8');
      expect(env.match(chromeTestPath)).to.not.be.null;
      expect(env.match(chromedriverTestPath)).to.not.be.null;
      expect(env.match(mockVersion)).to.not.be.null;
    });

    it('it creates an environment file when no version is given', async () => {
      mockInstall
        .withArgs(
          sinon.match({
            cacheDir: sinon.match.string,
            browser: 'chrome',
            buildId: sinon.match.string
          })
        )
        .returns({ executablePath: chromeTestPath });

      mockInstall
        .withArgs(
          sinon.match({
            cacheDir: sinon.match.string,
            browser: 'chromedriver',
            buildId: sinon.match.string
          })
        )
        .returns({ executablePath: chromedriverTestPath });

      await install('chrome');

      sinon.assert.calledWith(
        mockConsoleLog,
        'Setting env CHROME/CHROMEDRIVER_TEST_PATH/VERSION'
      );
      const env = await fsPromises.readFile(envPath, 'utf-8');
      expect(env.match(chromeTestPath)).to.not.be.null;
      expect(env.match(chromedriverTestPath)).to.not.be.null;
      expect(env.match(mockVersion)).to.not.be.null;
    });

    it('should error if unable to write the file', async () => {
      sinon.stub(fsPromises, 'writeFile').rejects('unable to write file');
      await expect(install(browser)).to.be.rejectedWith(
        'Error setting CHROME/CHROMEDRIVER_TEST_PATH/VERSION'
      );
    });
    describe('does not show download progress when', () => {
      it('there are no options passed', () => {
        const downloadProgressCaller = ({ downloadProgressCallback }) => {
          downloadProgressCallback();
          return { executablePath: chromeTestPath };
        };
        let { install } = proxyquire('../src/browser-driver-manager', {
          '@puppeteer/browsers': {
            ...puppeteerBrowserMocks,
            ...{
              install: downloadProgressCaller
            }
          }
        });
        install(browser);
        sinon.assert.notCalled(mockProcessStdoutWrite);
        // placing this in afterEach causes test logs to display incorrectly
        process.stdout.write = originalProcessStdoutWrite;
      });
      it('the verbose option is false', () => {
        const downloadProgressCaller = ({ downloadProgressCallback }) => {
          downloadProgressCallback();
          return { executablePath: chromeTestPath };
        };
        let { install } = proxyquire('../src/browser-driver-manager', {
          '@puppeteer/browsers': {
            ...puppeteerBrowserMocks,
            ...{
              install: downloadProgressCaller
            }
          }
        });
        install(browser, { verbose: false });
        sinon.assert.notCalled(mockProcessStdoutWrite);
        process.stdout.write = originalProcessStdoutWrite;
      });
    });
    describe('when the the verbose option is true', () => {
      beforeEach(() => {
        process.stdout.write = mockProcessStdoutWrite;
      });
      it('writes the browser and download progress', async () => {
        const downloadProgressCaller = ({ downloadProgressCallback }) => {
          downloadProgressCallback(1, 100);
          return { executablePath: chromeTestPath };
        };
        let { install } = proxyquire('../src/browser-driver-manager', {
          '@puppeteer/browsers': {
            ...puppeteerBrowserMocks,
            ...{
              install: downloadProgressCaller
            }
          }
        });
        await install(browser, { verbose: true });
        sinon.assert.calledWith(
          mockProcessStdoutWrite,
          sinon.match(/Downloading Chrome: 1%/)
        );
        process.stdout.write = originalProcessStdoutWrite;
      });
      it('writes when the download is done', async () => {
        const downloadProgressCaller = ({ downloadProgressCallback }) => {
          downloadProgressCallback(100, 100);
          return { executablePath: chromeTestPath };
        };
        let { install } = proxyquire('../src/browser-driver-manager', {
          '@puppeteer/browsers': {
            ...puppeteerBrowserMocks,
            ...{
              install: downloadProgressCaller
            }
          }
        });
        await install(browser, { verbose: true });
        sinon.assert.calledWith(
          mockProcessStdoutWrite,
          sinon.match(/Downloading Chrome: Done!/)
        );
        process.stdout.write = originalProcessStdoutWrite;
      });
    });
  });
});
