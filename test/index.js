const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const path = require('path');
const fsPromises = require('fs').promises;
const os = require('os');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const expect = chai.expect;
chai.use(chaiAsPromised);

const mockVersion = '126.0.6442.0';
const mockOverwriteVersion = '124.0.6367.207';

const MOCK_HOME_DIR = './mock-user-home-dir';
const MOCK_BDM_CACHE_DIR = path.resolve(
  MOCK_HOME_DIR,
  '.browser-driver-manager'
);
const envPath = path.resolve(MOCK_BDM_CACHE_DIR, '.env');
const chromeTestPath = `${MOCK_BDM_CACHE_DIR}/chrome/os_arch-${mockVersion}/chrome`;
const chromedriverTestPath = `${MOCK_BDM_CACHE_DIR}/chromedriver/os_arch-${mockVersion}/chromedriver`;
const envContents = `CHROME_TEST_PATH="${chromeTestPath}"${os.EOL}CHROMEDRIVER_TEST_PATH="${chromedriverTestPath}"${os.EOL}VERSION="${mockVersion}"`;
const noVersionEnvContents = `CHROME_TEST_PATH="${chromeTestPath}"${os.EOL}CHROMEDRIVER_TEST_PATH="${chromedriverTestPath}"${os.EOL}"`;

const mockResolveBuildId = sinon.stub();
const mockDetectBrowserPlatform = sinon.stub();
const mockInstall = sinon.stub();
const mockUninstall = sinon.stub();
const mockOSHomeDir = sinon.stub();
const mockBrowser = {
  CHROME: 'chrome',
  CHROMEDRIVER: 'chromedriver'
};
const puppeteerBrowserMocks = {
  detectBrowserPlatform: mockDetectBrowserPlatform,
  install: mockInstall,
  Browser: mockBrowser,
  resolveBuildId: mockResolveBuildId,
  uninstall: mockUninstall
};

const osMocks = {
  homedir: mockOSHomeDir,
  EOL: '\r\n'
};

const mockProcessStdoutWrite = sinon.stub();
const originalStdoutWrite = process.stdout.write;

let browser;

const { install, version, which } = proxyquire(
  '../src/browser-driver-manager',
  {
    '@puppeteer/browsers': puppeteerBrowserMocks,
    os: osMocks
  }
);

const setup = async () => {
  browser = 'chrome';

  mockDetectBrowserPlatform.returns('mac');
  mockInstall.returns({ executablePath: chromeTestPath });
  mockResolveBuildId.returns(mockVersion);
  mockOSHomeDir.returns(MOCK_HOME_DIR);
  try {
    await fsPromises.mkdir(MOCK_HOME_DIR, { recursive: true });
  } catch (e) {
    console.log('trying to mkdir error: ', e);
  }
};

const teardown = async () => {
  sinon.reset();
  await fsPromises.rm(MOCK_HOME_DIR, { recursive: true, force: true });
};

beforeEach(setup);

afterEach(teardown);

const makeEnvFile = async (contents = envContents) => {
  await fsPromises.mkdir(MOCK_BDM_CACHE_DIR, { recursive: true });
  await fsPromises.writeFile(envPath, contents);
};

// Wrap console.log stub only as needed
// Makes debugging more intuitive or suppresses logging in test results
let consoleLogStub;

const wrapConsoleLogStub = async fn => {
  consoleLogStub = sinon.stub(console, 'log');
  await fn();
  consoleLogStub.restore();
};

describe('browser-driver-manager', () => {
  describe('which', async () => {
    it('logs the locations of chrome and chromedriver if they exist', async () => {
      await makeEnvFile();
      await wrapConsoleLogStub(async () => {
        await which();
        sinon.assert.calledWith(consoleLogStub, envContents);
      });
    });
    it('errors if no environment file exists', async () => {
      await wrapConsoleLogStub(async () => {
        await expect(which()).to.be.rejectedWith(
          'No environment file exists. Please install first'
        );
      });
    });
  });
  describe('version', () => {
    it('logs the version when a valid one exists', async () => {
      await makeEnvFile();
      await wrapConsoleLogStub(async () => {
        await version();
        sinon.assert.calledWith(consoleLogStub, mockVersion);
      });
    });
    describe('errors', () => {
      it('if no environment file exists', async () => {
        await expect(version()).to.be.rejectedWith(
          'No environment file exists. Please install first'
        );
      });
      it('if the environment file does not contain a version', async () => {
        await makeEnvFile(noVersionEnvContents);
        await expect(version()).to.be.rejectedWith(
          'No version found in the environment file.'
        );
      });
    });
  });
  describe('install', () => {
    const chromeArgs = sinon.match({
      cacheDir: sinon.match.string,
      browser: 'chrome',
      buildId: sinon.match.string
    });
    const chromedriverArgs = sinon.match({
      cacheDir: sinon.match.string,
      browser: 'chromedriver',
      buildId: sinon.match.string
    });
    it('calls the Puppeteer/browser installer when given a valid browser', async () => {
      await wrapConsoleLogStub(async () => {
        await install(browser);
      });
      sinon.assert.calledWith(mockInstall, chromeArgs);
      sinon.assert.calledWith(mockInstall, chromedriverArgs);
    });
    describe('creates', () => {
      it("the cache directory if it doesn't already exist", async () => {
        await wrapConsoleLogStub(async () => {
          await install(browser);
        });
        await expect(fsPromises.access(MOCK_BDM_CACHE_DIR)).to.be.fulfilled;
      });

      it('the environment file when Puppeteer installer successfully returns paths to executables', async () => {
        mockInstall
          .withArgs(chromeArgs)
          .returns({ executablePath: chromeTestPath });

        mockInstall
          .withArgs(chromedriverArgs)
          .returns({ executablePath: chromedriverTestPath });

        await wrapConsoleLogStub(async () => {
          await install('chrome');

          sinon.assert.calledWith(
            consoleLogStub,
            'Setting env CHROME/CHROMEDRIVER_TEST_PATH/VERSION'
          );
        });
        await expect(fsPromises.readFile(envPath, 'utf-8')).to.be.fulfilled;
        const env = await fsPromises.readFile(envPath, 'utf-8');
        expect(env.match(chromeTestPath)).to.not.be.null;
        expect(env.match(chromedriverTestPath)).to.not.be.null;
        expect(env.match(mockVersion)).to.not.be.null;
      });
    });
    describe('errors when', () => {
      it('an unsupported browser is given', async () => {
        await expect(install('firefox')).to.be.rejectedWith(
          'The selected browser, firefox, could not be installed. Currently, only "chrome" is supported.'
        );
      });

      it('detectBrowserPlatform returns undefined', async () => {
        mockDetectBrowserPlatform.returns(undefined);
        await expect(install(browser)).to.be.rejectedWith(
          'Unable to detect a valid platform for'
        );
      });

      it('fsPromises.writeFile rejects', async () => {
        const fsWriteFileStub = sinon.stub(fsPromises, 'writeFile').rejects();
        await wrapConsoleLogStub(async () => {
          await expect(install(browser)).to.be.rejectedWith(
            'Error setting CHROME/CHROMEDRIVER_TEST_PATH/VERSION'
          );
        });
        fsWriteFileStub.restore();
      });

      it('unable to remove cache dir', async () => {
        const fsRmStub = sinon.stub(fsPromises, 'rm').rejects();
        await expect(install(browser)).to.be.rejectedWith(
          'Unable to remove .env'
        );
        fsRmStub.restore();
      });

      it('resolveBuildId throws', async () => {
        mockResolveBuildId.throws(new Error('invalid version'));
        await expect(install('chrome@broken')).to.be.rejectedWith(
          'invalid version'
        );
        sinon.assert.notCalled(mockInstall);
      });

      const browserInstallFailures = browser => {
        describe(`installing ${browser} throws`, async () => {
          [
            {
              error: 'status code 404',
              message: `Tried to install version ${mockVersion} of ${browser}`
            },
            {
              error: 'any other error',
              message: 'any other error'
            }
          ].forEach(({ error, message }) => {
            it(error, async () => {
              mockInstall
                .withArgs(
                  sinon.match({
                    cacheDir: sinon.match.string,
                    browser,
                    buildId: mockVersion
                  })
                )
                .throws(new Error(error));
              await expect(install(browser)).to.be.rejectedWith(message);
            });
          });
        });
      };

      ['chrome', 'chromedriver'].forEach(browser =>
        browserInstallFailures(browser)
      );
    });

    describe('called twice', () => {
      it('does not repeat installation if the version is already installed', async () => {
        await wrapConsoleLogStub(async () => {
          await install(browser);
          await install(browser);

          sinon.assert.calledWith(
            consoleLogStub,
            `Chrome and Chromedriver versions ${mockVersion} are already installed. Skipping installation.`
          );
          sinon.assert.calledTwice(mockInstall);
          await which();

          sinon.assert.calledWith(consoleLogStub, sinon.match(mockVersion));
        });
      });
      describe('when the given version differs from the previous version', () => {
        describe('and both are valid', async () => {
          it(`logs the currently installed version and that we're overwriting`, async () => {
            await wrapConsoleLogStub(async () => {
              await install(browser);
              mockResolveBuildId.returns(mockOverwriteVersion);
              await install(browser);
              sinon.assert.calledWith(
                consoleLogStub,
                sinon.match(
                  `Chrome and Chromedriver versions ${mockVersion} are currently installed. Overwriting.`
                )
              );
            });
          });
          describe('uninstalls the previous version of', () => {
            ['chrome', 'chromedriver'].forEach(browser => {
              it(browser, async () => {
                await wrapConsoleLogStub(async () => {
                  await install(browser);
                  mockResolveBuildId.returns(mockOverwriteVersion);
                  await install(browser);
                  sinon.assert.calledWith(
                    mockUninstall,
                    sinon.match({
                      buildId: mockVersion,
                      browser
                    })
                  );
                });
              });
            });
          });
          describe('installs the new version of', () => {
            ['chrome', 'chromedriver'].forEach(browser => {
              it(browser, async () => {
                await wrapConsoleLogStub(async () => {
                  await install(browser);
                  mockResolveBuildId.returns(mockOverwriteVersion);
                  await install(browser);
                  sinon.assert.calledWith(
                    mockInstall,
                    sinon.match({
                      buildId: mockOverwriteVersion,
                      browser
                    })
                  );
                });
              });
            });
          });
          it('logs the correct current version after installation', async () => {
            await wrapConsoleLogStub(async () => {
              await install(browser);
              mockResolveBuildId.returns(mockOverwriteVersion);
              await install(browser);
              await version();
              sinon.assert.calledWith(consoleLogStub, mockOverwriteVersion);
            });
          });
        });
        describe('with an invalid first version, and a valid second version', async () => {
          it('does not have an env file until the second installation', async () => {
            mockResolveBuildId.throws(new Error('invalid version'));
            await wrapConsoleLogStub(async () => {
              try {
                await install(browser);
              } catch (e) {
                expect(e.message).to.contain('invalid version');
              }
              try {
                await version();
              } catch (e) {
                expect(e.message).to.contain('No environment file exists.');
              }
            });
            mockResolveBuildId.returns(mockVersion);
            await wrapConsoleLogStub(async () => {
              await install(browser);
              await version();
              sinon.assert.calledWith(consoleLogStub, mockVersion);
            });
          });
        });
        describe('with a valid first version, and an invalid second version', async () => {
          it('still has the first version after the second attempt', async () => {
            mockResolveBuildId.returns(mockVersion);
            await wrapConsoleLogStub(async () => {
              await install(browser);
              await version();
              sinon.assert.calledWith(consoleLogStub, mockVersion);
            });
            mockResolveBuildId.throws(new Error('invalid version'));
            await wrapConsoleLogStub(async () => {
              try {
                await install(browser);
              } catch (e) {
                expect(e.message).to.contain('invalid version');
              }
              await version();
              sinon.assert.calledWith(consoleLogStub, mockVersion);
            });
          });
        });
        describe('with two invalid versions', async () => {
          it('has no environment file after either attempt', async () => {
            for (let i = 0; i < 2; i++) {
              mockResolveBuildId.throws(new Error('invalid version'));
              await wrapConsoleLogStub(async () => {
                try {
                  await install(browser);
                } catch (e) {
                  expect(e.message).to.contain('invalid version');
                }
                try {
                  await version();
                } catch (e) {
                  expect(e.message).to.contain('No environment file exists.');
                }
              });
            }
          });
        });
      });
    });
    describe('does not show download progress when', () => {
      it('there are no options passed', () => {
        const downloadProgressCaller = ({ downloadProgressCallback }) => {
          downloadProgressCallback(1, 1);
          return { executablePath: chromeTestPath };
        };
        let { install } = proxyquire('../src/browser-driver-manager', {
          '@puppeteer/browsers': {
            ...puppeteerBrowserMocks,
            ...{
              install: downloadProgressCaller
            }
          },
          process: {
            stdout: {
              write: mockProcessStdoutWrite
            }
          }
        });
        install(browser);
        sinon.assert.neverCalledWithMatch(
          mockProcessStdoutWrite,
          'Downloading Chrome'
        );
      });
      it('the verbose option is false', () => {
        const downloadProgressCaller = ({ downloadProgressCallback }) => {
          downloadProgressCallback(1, 1);
          return { executablePath: chromeTestPath };
        };
        let { install } = proxyquire('../src/browser-driver-manager', {
          '@puppeteer/browsers': {
            ...puppeteerBrowserMocks,
            ...{
              install: downloadProgressCaller
            }
          },
          process: {
            stdout: {
              write: mockProcessStdoutWrite
            }
          }
        });
        install(browser, { verbose: false });
        sinon.assert.neverCalledWithMatch(
          mockProcessStdoutWrite,
          'Downloading Chrome'
        );
      });
    });
    describe('when the verbose option is true', () => {
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
          },
          os: osMocks
        });
        process.stdout.write = mockProcessStdoutWrite;
        await install(browser, { verbose: true });
        process.stdout.write = originalStdoutWrite;
        sinon.assert.calledWith(
          mockProcessStdoutWrite,
          sinon.match(/Downloading Chrome.../)
        );
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
          },
          os: osMocks
        });
        process.stdout.write = mockProcessStdoutWrite;
        await install(browser, { verbose: true });
        process.stdout.write = originalStdoutWrite;
        sinon.assert.calledWith(mockProcessStdoutWrite, sinon.match(/Done!/));
      });
    });
  });
});
