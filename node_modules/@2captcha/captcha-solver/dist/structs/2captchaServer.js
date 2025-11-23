"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = void 0;
const events_1 = require("events");
// For creating the server
const http = __importStar(require("http"));
/**
 * ! WIP
 * This class will bind an http server to a specific port to allow for post requests from the 2captcha site, providing
 * an alternative to manually polling each captcha. A feature 2captcha allows for massive solve requirements.
 */
class Server extends events_1.EventEmitter {
    constructor(apikey, serverAddr, serverPort, pingbackString, enableACAO = true) {
        super();
        this._terminated = false;
        this._apikey = apikey;
        this._headerACAO = enableACAO ? 1 : 0;
        this._serverAddr = serverAddr;
        this._serverPort = serverPort;
        this._pingbackString = pingbackString;
        this.server();
    }
    async server() {
        const server = http.createServer((req, res) => {
            if (req.method == "POST") {
                let body = '';
                req.on('data', chunk => {
                    body += chunk.toString(); // convert Buffer to string
                });
                req.on('end', () => {
                    console.log(body);
                    res.end('ok');
                });
            }
            if (req.method == "GET" && req.url == "/2captcha.txt") {
                console.log("writing");
                res.write(this._pingbackString, "utf8");
                res.end();
            }
        });
        server.listen(this._serverPort);
        // let i = setInterval(() => {
        //     if (this._terminated == true) {
        //         clearInterval(i);
        //         server.close();
        //     }
        // }, 100)
    }
    get defaultPayload() {
        return {
            key: this._apikey, json: 1, header_acao: this._headerACAO, soft_id: 4587
        };
    }
    /**
     * Termintes the running HTTP server.
     */
    terminate() {
        this._terminated = true;
    }
    requestRecaptcha(params) {
        const payload = {
            ...params,
            method: "userrecaptcha",
            ...this.defaultPayload
        };
    }
}
exports.Server = Server;
