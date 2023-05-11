const puppeteer = require('puppeteer-extra');
require('log-timestamp');
const chromeLauncher = require('chrome-launcher');

const profiles = require("./profiles");
const TestFinderError = require('./utils/test-finder-error');
const Validator = require('./utils/validator');
const SlotNoLongerAvailableError = require('./utils/slot-no-longer-available-error');

const URL = "https://driverpracticaltest.dvsa.gov.uk/login";

const TIMEOUT = { min: 8 * 1000, max: 15 * 1000 };

const BOOKING_DATE_REGEX = /.+\s(?<day>\d*)\/(?<month>\d*)\/(?<year>\d*)/;

const userSleepFactor = process.argv[2] || 1;

const validator = new Validator(puppeteer);

let page;

let profile;

let minimumDate = new Date();
minimumDate.setDate(minimumDate.getDate() + 6);

(async () => {
	await sleepDuringTheNight();
	console.info("sleep factor: " + userSleepFactor);
	console.info("starting to look for test with profiles:\n" + JSON.stringify(profiles));

	await login();

	await findTests();
})();

async function timeout() {
	const duration = userSleepFactor * (Math.random() * (TIMEOUT.max - TIMEOUT.min + 1) + TIMEOUT.min);
	await new Promise(resolve => setTimeout(resolve, duration));
}
async function submit(selector) {
	const button = await page.waitForSelector(selector, { visible: true });
	await Promise.all([
		button.evaluate(b => b.click()),
		page.waitForNavigation({
			waitUntil: 'networkidle2'
		})
	]);
}

function switchProfile() {
	let profileIndex = profiles.indexOf(profile);
	profileIndex = (profileIndex + 1) % profiles.length;
	profile = profiles[profileIndex];

	if (profile) {
		console.info("switched to profile " + profile.licenceNumber);
		setTestCenterSelector();
	}

	return profileIndex === 0;
}

function setTestCenterSelector() {
	const monthsRange = [];

	const dateAux = new Date();
	for (dateAux.setDate(1);
		 dateAux.getMonth() === profile.testDate.getMonth() || dateAux < profile.testDate;
		 dateAux.setMonth(dateAux.getMonth() + 1)) {
		monthsRange.push(`contains(text(), "/${('0' + (dateAux.getMonth() + 1)).slice(-2)}/")`);
	}

	profile.testCenterSelector =
		`//ul[@class="test-centre-results"]/li[position() <= ${profile.testCenters}]//span/h5[${monthsRange.join(' or ')}]`;
}

async function login(restartBrowser = true) {
	for (let i = 0; ; i++) {
		try {
			if (restartBrowser && switchProfile()) {
				await initPage();
			}

			await page.goto(URL, { waitUntil: 'networkidle0'});

			await validator.validate(page);
			await acceptCookies();
			await page.type("#driving-licence-number", profile.licenceNumber);

			await page.type("#application-reference-number", profile.referenceNumber);
			await submit("#booking-login");

			await validator.validate(page);

			await submit("#test-centre-change");
			await validator.validate(page);

			break;
		} catch (error) {
			if (i < 10 && isRetryable(error)) {
				console.error(error.message);
				restartBrowser = error.restartBrowser;
				await timeout();
			} else {
				await takeScreenshot();
				throw error;
			}
		}
	}

	await page.$eval("#test-centres-input", el => (el.value = ""));
	await page.type("#test-centres-input", profile.postCode);
}

async function acceptCookies() {
	const acceptCookiesDialogue = await page.$('#cookie-banner-accept-all');
	if (acceptCookiesDialogue && await acceptCookiesDialogue.boundingBox()) {
		await acceptCookiesDialogue.click();
	}
}

const isRetryable = error =>
	error instanceof TestFinderError
	|| error.message.includes('Execution context')
	|| error.message.includes("Timeout exceeded")
	|| error.message.includes("ERR_");

async function submitWithoutNewPage(selector) {
	await Promise.all([
		page.click(selector),
		page.waitForResponse(response =>
			response.url().includes('Bewarfish')
			&& response.request().method() === 'POST'
			&& !response.fromCache())
	]);
}

async function takeScreenshot() {
	if (page) {
		await page.screenshot({
			path: `screenshot ${new Date().getTime()}.png`,
			fullPage: true
		});
	}
}

async function chooseDate(testCenterAvailability) {
	const testCenterGeneralSelector = `.BookingCalendar-date--bookable`;
	let chosenDate = await page.$(`${testCenterGeneralSelector} a.BookingCalendar-dateLink[data-date="${testCenterAvailability}"]`);
	if (chosenDate) {
		await chosenDate.click();
		return testCenterAvailability;
	}

	const allDates = await page.$$(testCenterGeneralSelector);
	for (let i = 0; !chosenDate && i < allDates.length; i++) {
		chosenDate = allDates[i];
		testCenterAvailability = await chosenDate.$eval('.BookingCalendar-dateLink', element => element.getAttribute('data-date'));
		if (isEligibleDate(testCenterAvailability)) {
			await chosenDate.click();
		} else {
			chosenDate = null;
		}
	}

	if (!chosenDate) {
		await takeScreenshot();
		throw new SlotNoLongerAvailableError(testCenterAvailability);
	}
	return testCenterAvailability;
}


async function bookTest(testCenter, testCenterAvailability) {
	await testCenter.click();
	await page.waitForSelector("#change-test-centre", { visible: true });

	const chosenDate = await chooseDate(testCenterAvailability);

	const lastTime = await page.waitForSelector('li.SlotPicker-day.is-active label:last-of-type', { visible: true });
	await lastTime.click();

	await page.click('#slot-chosen-submit');

	await page.click('#slot-warning-continue');
	await page.waitForSelector('.error-summary, #i-am-candidate', { visible: true });

	const slotNotAvailableError = await page.$('.error-summary');
	if (slotNotAvailableError && await slotNotAvailableError.boundingBox()) {
		await takeScreenshot();
		throw new SlotNoLongerAvailableError(chosenDate);
	} else {
		await validator.quickValidate(page);
		await page.click("#i-am-candidate");
		await submit('#confirm-changes');
		await takeScreenshot();
		console.info(`booking confirmed - ${chosenDate}!!!`);
		return chosenDate;
	}
}

async function sleepDuringTheNight() {
	let slept = false;
	const startTime = new Date();
	startTime.setHours(6);
	startTime.setMinutes(2);

	while (new Date() < startTime) {
		if (!slept) {
			console.info("sleeping during the night");
		}
		slept = true;
		await timeout();
	}
}

async function findTestCenters() {
	await submitWithoutNewPage('#test-centres-submit');

	const results = await page.$x(profile.testCenterSelector);

	if (!results || !results.length) {
		await validator.validate(page);
	}
	return results;
}

function isEligibleDate(firstCenterAvailability) {
	const firstCenterAvailabilityDate = new Date(firstCenterAvailability);
	return firstCenterAvailabilityDate < profile.testDate && minimumDate < firstCenterAvailabilityDate
		&& firstCenterAvailabilityDate.getDay() !== 0
		&& firstCenterAvailabilityDate.getDay() !== 6
		&& (!profile.holidayStart
			|| (profile.holidayStart > firstCenterAvailabilityDate || profile.holidayEnd < firstCenterAvailabilityDate));
}

async function getTestCenterAvailability(testCenter) {
	const firstCenterAvailability = await testCenter.evaluate(el => el.textContent);
	const dateMatch = BOOKING_DATE_REGEX.exec(firstCenterAvailability).groups;
	return `${dateMatch.year}-${dateMatch.month}-${dateMatch.day}`;
}

async function bookTestIfEligible(testCenter) {
	const testCenterAvailability = await getTestCenterAvailability(testCenter);
	if (isEligibleDate(testCenterAvailability)) {
		const chosenDate = await bookTest(testCenter, testCenterAvailability);
		if (chosenDate) {
			profile.testDate = new Date(chosenDate);
			await login();
			return true;
		}
	}
}

async function onFindTestsError(error, searchCounter) {
	if (isRetryable(error)) {
		console.error(error.message);
		if (error.restartBrowser) {
			searchCounter = 0;
		}
		await login(error.restartBrowser);
	} else {
		await takeScreenshot();
		const pageAsHtml = await page.content();
		console.info("error page HTML: \n" + pageAsHtml);
		throw error;
	}
	return searchCounter;
}

async function findTests() {
	for (let searchCounter = 1; profile; searchCounter++) {
		try {
			const testCenters = await findTestCenters();

			for (const testCenter of testCenters) {
				if (await bookTestIfEligible(testCenter)) {
					searchCounter = 0;
					break;
				}
			}

			await validator.validate(page);

			if (searchCounter % 10 === 0) {
				console.info(searchCounter + ' searches so far');
			}
			await timeout();
		} catch (error) {
			searchCounter = await onFindTestsError(error, searchCounter);
		}
	}
}

async function initPage() {
	if (page) {
		await page.browser().close();
		await timeout();
	}

	const chrome = await chromeLauncher.launch();
	const browser = await puppeteer.connect({
		browserURL: "http://127.0.0.1:" + chrome.port,
		defaultViewport: {
			width: 1920,
			height: 2880
		},
		slowMo: 20
	});
	page = await browser.newPage();
	page.setDefaultTimeout(2 * 60 * 1000);
}