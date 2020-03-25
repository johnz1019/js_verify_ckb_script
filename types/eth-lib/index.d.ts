declare module 'eth-lib' {
  export namespace Account {
    export function fromPrivate(
      privateKey: string
    ): { address: string; privateKey: string };
  }
}
