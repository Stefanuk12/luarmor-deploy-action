/**
 * ### Captcha Required Parameters Check.
 *
 * Checking required captcha parameters before sending.
 * This function checks for required fields in the provided captcha parameters.
 * Throws an error if the specified method is not supported or if required fields are missing.
 *
 * Note: The `checkCaptchaParams()` function should be called after `renameParams()`, if function `renameParams()` is used.
 *
 * @param { Object } params Captcha parameters that need to be checked.
 * @returns true | false | Error
 * @example
 * checkCaptchaParams(params, 'userrecaptcha')
 */
export default function checkCaptchaParams(params: Object, method: string): boolean | undefined;
//# sourceMappingURL=checkCaptchaParams.d.ts.map