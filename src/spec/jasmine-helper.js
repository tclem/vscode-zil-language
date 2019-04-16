const TSConsoleReporter = require('jasmine-ts-console-reporter');
const util = require('util');

const consoleReporter = new TSConsoleReporter({
    print: function () {
        let msg = util.format.apply(this, arguments).replace('\n', '');
        if (msg.length !== 0) { console.log(msg); }
    }
});

jasmine.getEnv().clearReporters(); // Clear default console reporter
jasmine.getEnv().addReporter(consoleReporter);
