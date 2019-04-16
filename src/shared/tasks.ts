"use strict";

export const TASK_SOURCE_NAME = "ZIL";

export function getBuildTaskLabel(mainFileBaseName: string, build: "release" | "debug") {
    const suffix = `${build === "debug" ? "Debug" : "Release"}`;
    return `Build ${mainFileBaseName} (${suffix})`;
}
