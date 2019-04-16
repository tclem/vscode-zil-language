declare module "jasmine-ts-console-reporter" {
    import jasmine = require("jasmine");

    interface Timer {
        start(): void;
        elapsed(): number;
    }

    interface Options {
        jasmineCorePath?: string;
        timer?: Timer;
        print?: (format: string, ...param: any[]) => void;
        showColors?: boolean;
        titleFilter?: (s: string) => string;
		stackFilter?: (s: string) => string;
		messageFilter?: (s: string) => string;
    }

    const TSConsoleReporter: {
        new(options?: Options): jasmine.Reporter;
    };

    export = TSConsoleReporter;
}