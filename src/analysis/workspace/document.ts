"use strict";

import URI from "./uri";

export default interface Document {
    uri: URI;
    version: number;
    getText(): string;
}
