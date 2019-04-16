import * as path from "path";

import Jasmine = require("jasmine");
import TSConsoleReporter = require("jasmine-ts-console-reporter");

export function run(testsRoot: string, clb: (error: any, failures?: number) => void): void {
    try {
        const projectBaseDir = path.join(testsRoot, "../..");
        const jasmine = new Jasmine({ projectBaseDir });

        jasmine.loadConfigFile(path.join(projectBaseDir, "src/spec/jasmine.json"));
        jasmine.onComplete((passed) => {
            clb(null, passed ? 0 : 1);
        }); // TODO: use jsApiReporter?

        jasmine.execute();
    } catch (error) {
        console.error(error);
        return clb(error);
    }
}
