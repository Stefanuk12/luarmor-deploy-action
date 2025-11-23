/// <reference types="node" />
import { EventEmitter } from "events";
import { paramsRecaptcha } from "./2captcha.js";
export interface ServerCaptchaResult {
    data: string;
    id: string;
}
export interface ServerEvents {
    "recaptcha": (captcha: ServerCaptchaResult) => void;
    "hcaptcha": (captcha: ServerCaptchaResult) => void;
}
export interface Server {
    on<U extends keyof ServerEvents>(event: U, listener: ServerEvents[U]): this;
}
/**
 * ! WIP
 * This class will bind an http server to a specific port to allow for post requests from the 2captcha site, providing
 * an alternative to manually polling each captcha. A feature 2captcha allows for massive solve requirements.
 */
export declare class Server extends EventEmitter {
    private _apikey;
    private _headerACAO;
    private _serverAddr;
    private _serverPort;
    private _pingbackString;
    private _terminated;
    constructor(apikey: string, serverAddr: string, serverPort: number, pingbackString: string, enableACAO?: boolean);
    private server;
    private get defaultPayload();
    /**
     * Termintes the running HTTP server.
     */
    terminate(): void;
    requestRecaptcha(params: paramsRecaptcha): void;
}
//# sourceMappingURL=2captchaServer.d.ts.map