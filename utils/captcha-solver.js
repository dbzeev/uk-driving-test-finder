const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const TestFinderError = require('./test-finder-error');
const config = require('../config.json')

const TEMPORARY_BAN_IN_MINUTES = 30;

class CaptchaSolver {
    constructor(puppeteer) {
        puppeteer.use(
            RecaptchaPlugin({
                provider: {
                    id: '2captcha',
                    token: config.captchaToken
                },
                throwOnError: true
            })
        );
    }

    async solve(page) {
        await this.solveLocally(page, true);

        if (this.getFirstChildFrame(page)) {
            await this.solveRemotely(page);
        }

        if (this.getFirstChildFrame(page)) {
            await this.handleBan(page);
        }
    }

    async handleBan(page) {
        console.warn(`Temporary ban`);
        await page.waitForTimeout(TEMPORARY_BAN_IN_MINUTES * 60 * 1000);
        throw new TestFinderError('trying to recover from ban');
    }

    async solveRemotely(page) {
        let solution;
        for (let i = 0; i < 3 && !solution; i++) {
            try {
                if (this.getFirstChildFrame(page)) {
                    solution = await this.getFirstChildFrame(page).solveRecaptchas();
                }
            } catch (error) {
                console.warn("error calling remote captcha service:\n" + error)
                await page.waitForTimeout(5 * 1000);
            }
        }
        if (solution && solution.solutions.length) {
            await page.waitForNavigation({ waitUntil: 'networkidle0' });
        }
    }

    async solveLocally(page, slowMo) {
        await page.waitForTimeout(slowMo ? 2000 : 100);

        let captchaDialog = this.getFirstChildFrame(page);
        captchaDialog = captchaDialog.childFrames()[0];
        if (captchaDialog) {
            captchaDialog = await captchaDialog.$('.recaptcha-checkbox-border');
            if (captchaDialog) {
                await captchaDialog.click();
                await page.waitForTimeout(slowMo ? 4000 : 2000);
            }
        }
    }

    getFirstChildFrame = page => page.mainFrame().childFrames()[0];
}

module.exports = CaptchaSolver;