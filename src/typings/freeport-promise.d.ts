declare module "freeport-promise" {
    function freeport(): Promise<number>;
    function freeport(promiseLibrary: PromiseConstructorLike): PromiseLike<number>;
    export = freeport;
}
