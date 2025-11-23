"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("../constants/constants");
const defautlProvider = constants_1.supportedProviders.twoCaptcha.name;
function getProviderData(provider = defautlProvider) {
    const currentProvider = provider;
    let currentProviderData;
    switch (currentProvider) {
        case '2captcha':
            currentProviderData = constants_1.supportedProviders.twoCaptcha;
            break;
        case 'ruCaptcha':
            currentProviderData = constants_1.supportedProviders.ruCaptcha;
            break;
        default:
            currentProviderData = constants_1.supportedProviders.twoCaptcha;
    }
    return currentProviderData;
}
exports.default = getProviderData;
