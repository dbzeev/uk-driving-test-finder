const TestFinderError = require('./test-finder-error');
const CaptchaSolver = require('./captcha-solver');

const MAX_RETRIES = 30;

class Validator {

    lastSearchLimitTime = new Date();

    constructor(puppeteer) {
        this.captchaSolver = new CaptchaSolver(puppeteer);
        this.captchaOccurred = false;
    }

    async validate(page) {
        await this.validateSearchLimit(page);

        if (await page.$('#unavailability-notice')) {
            await page.waitForTimeout(30 * 60 * 1000);
            throw new TestFinderError("service unavailable");
        }
        await this.validateWentAwayError(page);

        await this.recoverFromErrorIfNeeded(page, 'meta[name="ROBOTS"]', "captcha needed", true);
        await this.recoverFromErrorIfNeeded(page, '[data-pageid="queue"]', "queue", false);
        await this.validateStatus403(page);

        await this.validateWentAwayError(page);
    }

    validateStatus403 = async page => this.throwRecoverableErrorIfNeeded(page, 'head title', 'Status 403', false);

    async validateSearchLimit(page) {
        let limitDialog = await page.$('.dialog-buttons #warning-ok');
        limitDialog = limitDialog || await page.$('a[href="https://www.gov.uk/change-driving-test"]');
        if (limitDialog) {
            await limitDialog.click();
            console.warn('search limit reached');
            await this.waitOnSearchLimitReached(page);
            throw new TestFinderError('trying to recover from search limit');
        }
    }

    async waitOnSearchLimitReached(page) {
        const now = new Date();

        this.lastSearchLimitTime.setMinutes(this.lastSearchLimitTime.getMinutes() + 5);
        let timeoutFactor = 12;
        if (this.lastSearchLimitTime > now) {
            timeoutFactor = 5 * 60;
            console.warn('long timeout after 2 consecutive search limits reached');
        }
        this.lastSearchLimitTime = now;

        await page.waitForTimeout(timeoutFactor * 1000);
    }

    async validateWentAwayError(page) {
        let wentAwayButton =
            await page.$('div[data-journey="pp-book-practical-driving-test-public:you-went-away-and-came-back-again"] .formatting a');
        if (wentAwayButton) {
            await wentAwayButton.click();
            throw new TestFinderError('Went away and came back again error');
        }
    }

    async recoverFromErrorIfNeeded(page, errorSelector, errorMessage, isCaptcha) {
        let errorExists = true;
        let errorExisted;
        for (let i = 0; i < MAX_RETRIES && errorExists; i++) {
            errorExists = await page.$(errorSelector);
            if (errorExists) {
                errorExisted = true;
                console.warn(errorMessage);
                if (isCaptcha && i === 0) {
                    this.captchaOccurred = true;
                    await this.captchaSolver.solve(page);
                } else {
                    await page.waitForTimeout(12 * 1000)
                }
                await this.throwRecoverableErrorIfNeeded(page, 'meta[name="ROBOTS"]', "Request unsuccessful", true);
                await this.validateStatus403(page);
            }
        }
        if (errorExists) {
            throw new TestFinderError("retries limit reached for " + errorMessage);
        }
        if (errorExisted) {
            console.info("recovered from " + errorMessage)
        }
    }

    async throwRecoverableErrorIfNeeded(page, selector, errorMessage, restartBrowser) {
        let errorElement = await page.$(selector);
        if (errorElement) {
            errorElement = await errorElement.evaluate(el => el.textContent);
            if (errorElement.includes(errorMessage)) {
                throw new TestFinderError(errorMessage, restartBrowser);
            }
        }
    }

    async quickValidate(page) {
        if (!this.captchaOccurred && page.mainFrame().childFrames().length) {
            await this.captchaSolver.solveLocally(page)
        }
    }
}

module.exports = Validator