declare module "strip-bom-stream" {
    import { Duplex } from "stream";
    function stripBomStream(): Duplex;
    export = stripBomStream;
}
