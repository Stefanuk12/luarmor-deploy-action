/**
 * @typedef {Object} HandlerResult
 * @property {string} [url] what to fetch next
 * @property {number} [repeatAfter] of milliseconds to wait befor next try
 * @property {string} [message] to report
 * @property {boolean} done op is finished return
 * @property {Response} response
 * @property {boolean} postprocess exec postprocess
 */

/**
 * Function to provide progress report.
 * @typedef {Function} RequestReporter
 * @property {string} url to be requested
 * @property {string} method http method name
 * @property {string|Error} status result of the last request
 * @property {number} nthTry how often have we retried
 */

/**
 * @param {URL|string} url
 * @param {Object} options
 * @param {Object} result
 */
async function wait(url, options, result) {
  if (result.repeatAfter > 0) {
    result.message &&
      options.reporter?.(url, options.method || "GET", result.message);

    await new Promise(resolve => setTimeout(resolve, result.repeatAfter));
  }
}

const FAILED_RESPONSE = { ok: false, state: -1 };
const DUMMY_RESPONSE = { ok: false };

/**
 * Executes fetch operation and handles response.
 * @param {string|URL} url
 * @param {Object} options
 * @param {RequestReporter} options.reporter
 * @param {Object} [options.cache]
 * @param {number} [options.maxRetries]
 * @param {string} [options.method]
 * @param {Object} [options.headers]
 * @param {string} [options.body]
 * @param {Function} options.postprocess
 * @param {Object} options.stateActions
 * @return {Promise<Response>} from fetch
 */
export async function stateActionHandler(url, options) {
  options = { ...defaultOptions, ...options };

  const reporter = options.reporter;
  const postprocess = options.postprocess;
  const stateActions = options.stateActions;

  if (
    (options.method === "GET" || options.method === "HEAD") &&
    options.cache
  ) {
    await options.cache.addHeaders(url, options.headers);
  }

  for (let nthTry = 1; nthTry < options.maxRetries; nthTry++) {
    let result;
    try {
      const o = {};

      if (options.method) {
        o.method = options.method;
      }
      if (options.headers) {
        o.headers = options.headers;
      }
      if (options.body) {
        o.body = options.body;
      }

      let response = (await fetch(url, o)) || { ...FAILED_RESPONSE };
      const action = stateActions[response.status] || defaultHandler;
      result = await action(response, options, nthTry);
      response = result.response || { ...FAILED_RESPONSE };

      reporter?.(url, options.method, response.status, nthTry);

      if (result.done) {
        if (postprocess) {
          if (result.postprocess) {
            return await postprocess(response);
          }
          return { response };
        }

        return response;
      }

      await wait(url, options, result);

      if (result.url) {
        url = result.url;
      }
    } catch (e) {
      reporter?.(url, options.method, e, nthTry);

      const action = stateActions[e.errno || e.cause?.code];

      if (action) {
        result = await action({ ...DUMMY_RESPONSE }, options, nthTry);

        if (result.repeatAfter === undefined) {
          throw e;
        }

        await wait(url, options, result);
      } else {
        throw e;
      }
    }
  }

  throw new Error(
    `${url},${options.method}: Max retry count reached (${options.maxRetries})`
  );
}

/**
 * 
 * @param {*} response 
 * @returns {number|undefined} msecs to wait
 */
function calculateRepeatAfter(response) {
  if (response.headers) {
    const headers = {
      "retry-after": value =>
        value.match(/^\d+$/) ? parseInt(value) * 1000 : undefined,
      "x-ratelimit-reset": value => {
        const rateLimitReset = parseInt(value);
        return isNaN(rateLimitReset)
          ? DEFAULT_MIN_WAIT_MSECS
          : new Date(rateLimitReset * 1000).getTime() - Date.now();
      }
    };
    for (const [key, f] of Object.entries(headers)) {
      const value = response.headers.get(key);
      if (value !== null && value !== undefined) {
        const repeatAfter = f(value);
        return repeatAfter < DEFAULT_MIN_WAIT_MSECS
          ? DEFAULT_MIN_WAIT_MSECS
          : repeatAfter;
      }
    }
  }
}

/**
 * Waits and retries after rate limit reset time has reached.
 * @see https://auth0.com/docs/policies/rate-limit-policy
 * @see https://developer.github.com/v3/#rate-limiting
 * @see https://opensource.zalando.com/restful-api-guidelines/#153
 * @param {Response} response from fetch
 * @param {Object} options
 * @param {number} nthTry
 * @returns {HandlerResult}
 */
export function rateLimitHandler(response, options, nthTry) {
  const repeatAfter = calculateRepeatAfter(response);

  if (repeatAfter) {
    return {
      repeatAfter,
      done: false,
      postprocess: false,
      response,
      message: `Rate limit reached: waiting for ${repeatAfter / 1000}s`
    };
  }

  return { done: true, response, postprocess: response.ok };
}

/**
 * Retry timeouts with
 * increasing delay for each retry.
 * Values in msecs.
 */
const retryTimes = [300, 15000, 45000, 80000];

const slowRetryTimes = [5000, 60000, 600000];

/**
 * Try several times with a increasing delay.
 * @param {Response} response from fetch
 * @param {Object} options
 * @param {number} nthTry
 * @returns {HandlerResult}
 */
export function retryHandler(response, options, nthTry) {
  const repeatAfter = calculateRepeatAfter(response) || retryTimes[nthTry];

  if (repeatAfter) {
    return {
      done: false,
      response,
      postprocess: false,
      repeatAfter,
      message: `Waiting for ${repeatAfter / 1000}s`
    };
  }

  return { done: false, response, postprocess: false };
}

export function slowRetryHandler(response, options, nthTry) {
  const repeatAfter = calculateRepeatAfter(response) || slowRetryTimes[nthTry];

  if (repeatAfter) {
    return {
      done: false,
      response,
      postprocess: false,
      repeatAfter,
      message: `Waiting for ${repeatAfter / 1000}s`
    };
  }

  return { done: false, response, postprocess: false };
}

/**
 * Redirect to given header location.
 * @param {Response} response from fetch
 * @param {Object} options
 * @param {number} nthTry
 * @returns {HandlerResult}
 */
export function redirectHandler(response, options, nthTry) {
  if (nthTry <= 3) {
    return {
      done: false,
      postprocess: false,
      repeatAfter: 0,
      response,
      url: response.headers.get("location")
    };
  }
  return { done: false, response, postprocess: false };
}

/**
 * Postprocessing if response is ok.
 * @param {Response} response from fetch
 * @param {Object} options
 * @param {number} nthTry
 * @returns {HandlerResult}
 */
export function defaultHandler(response, options, nthTry) {
  options.cache?.storeResponse(response);
  return { done: true, response, postprocess: response.ok };
}

/**
 * No postprocessing.
 * @param {Response} response from fetch
 * @param {Object} options
 * @param {number} nthTry
 * @returns {HandlerResult}
 */
export function errorHandler(response, options, nthTry) {
  return { done: true, response, postprocess: false };
}

/**
 * Provide cached data.
 * @param {Response} response from fetch
 * @param {Object} options
 * @param {number} nthTry
 * @returns {Promise<HandlerResult>}
 */
export async function cacheHandler(response, options, nthTry) {
  response = await options.cache.loadResponse(response);
  return {
    done: response.ok,
    postprocess: response.ok,
    response,
    message: "from cache"
  };
}

/**
 * Minimum wait time in msecs.
 */
export const DEFAULT_MIN_WAIT_MSECS = 2000;

/**
 * Max # of retries.
 */
export const DEFAULT_MAX_RETRIES = 4;

export const defaultStateActions = {
  "-1": retryHandler,
  0: retryHandler,
  // 201: defaultHandler, // Created
  // 202: defaultHandler, // Accepted
  301: redirectHandler, // Moved Permanently
  302: redirectHandler, // Found
  303: redirectHandler, // See Other
  304: cacheHandler, // Not Modified
  307: redirectHandler, // Temporary Redirect
  308: redirectHandler, // Permanent Redirect
  400: errorHandler, // Bad Request
  // 401: defaultHandler,
  403: rateLimitHandler,
  // 404: defaultHandler, // NOT Found
  408: retryHandler, // Request timeout
  409: retryHandler, // Conflict
  412: errorHandler, // precondition failed
  413: errorHandler, // Content Too Large
  420: retryHandler, // Method Failure or Enhance your calm
  // 422: defaultHandler, // UNPROCESSABLE ENTITY
  423: retryHandler,
  425: retryHandler, // Too Early
  429: rateLimitHandler, // The service is overloaded
  430: retryHandler,
  444: retryHandler,
  // 451: defaultHandler,
  500: retryHandler, // Internal Server Error
  502: retryHandler, // Bad Gateway
  503: retryHandler, // Service Unavailable
  504: retryHandler, // Gateway Timeout
  507: errorHandler, // Insufficient Storage
  509: retryHandler,
  529: retryHandler,
  598: retryHandler, // Network Read Timeout Error
  599: retryHandler,

  ERR_STREAM_PREMATURE_CLOSE: retryHandler,
  UND_ERR_CONNECT_TIMEOUT: retryHandler,
  UND_ERR_SOCKET: slowRetryHandler, // other side closed ?
  ECONNRESET: slowRetryHandler,
  EAI_AGAIN: retryHandler,
};

/**
 * Default options
 */
const defaultOptions = {
  stateActions: defaultStateActions,
  headers: {},
  method: "GET",
  maxRetries: DEFAULT_MAX_RETRIES,
  minWaitTime: DEFAULT_MIN_WAIT_MSECS
};
