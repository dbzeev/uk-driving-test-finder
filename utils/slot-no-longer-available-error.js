const TestFinderError = require('./test-finder-error');

class SlotNoLongerAvailableError extends TestFinderError {
    constructor(wantedDate) {
        super('slot no longer available - wanted date: ' + wantedDate, false);
    }
}

module.exports = SlotNoLongerAvailableError;