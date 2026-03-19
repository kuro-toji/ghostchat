declare module 'argon2-browser' {
  export interface Argon2Options {
    pass: string | Uint8Array;
    salt: Uint8Array;
    time?: number;
    mem?: number;
    hashLen?: number;
    parallelism?: number;
    type?: number;
    distPath?: string;
  }

  export interface Argon2Result {
    hash: Uint8Array;
    hashHex: string;
    encoded: string;
    verify: boolean;
  }

  export function hash(options: Argon2Options): Promise<Argon2Result>;
  export function verify(encoded: string, pass: string | Uint8Array): Promise<boolean>;

  export const memory: number;
  export const time: number;
  export const parallelism: number;
}
