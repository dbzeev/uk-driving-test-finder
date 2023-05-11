class TestFinderError extends Error {

    constructor(errorMessage, restartBrowser = true) {
        super(errorMessage);
        this.restartBrowser = restartBrowser;
    }
}

module.exports = TestFinderError