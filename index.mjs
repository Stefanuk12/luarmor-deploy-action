// Dependencies
import * as fs from "fs";
import { setFailed, getInput, getBooleanInput } from "@actions/core";
import { stateActionHandler } from "fetch-rate-limit-util";
import { Solver } from "@2captcha/captcha-solver";

/**
 * The main entry point
 * @returns {Promise<void>}
 * @throws {Error} If the project id cannot be resolved or captcha fails
 */
async function run() {
  // Grab the variables
  const twoCaptchaApiKey = getInput("twocaptcha-api-key");
  const apiKey = getInput("api-key");
  const scriptId = getInput("script-id");
  let projectId = getInput("project-id");
  const filePath = getInput("file");
  const solveCaptcha = getBooleanInput("solve-captcha");
  const customHeaders = parseHeaders(getInput("headers"));

  if (solveCaptcha && !twoCaptchaApiKey) {
    throw new Error(
      "twocaptcha-api-key is required, unless solve-captcha is false"
    );
  }

  // Grab the current details
  const details = await getKeyDetails(apiKey);

  // Resolve the projectId, if it's not specified
  const project = resolveProject(details, scriptId, projectId);
  if (!project) {
    throw new Error("could not find project. invalid projectId or scriptId?");
  }

  // Extract the current version number (script object contains `script_version`)
  const currentScript = getScript(project, scriptId);
  const currentVersion = currentScript?.script_version;
  if (!currentVersion) {
    throw new Error(
      "could not get current script version. this should not happen."
    );
  }

  // Read the file
  const file = await fs.promises
    .readFile(filePath)
    .then((data) => data.toString());

  // Attempt to update the script
  const solver = solveCaptcha ? new Solver(twoCaptchaApiKey) : undefined;
  const updateResponse = await updateScript(
    scriptId,
    project.id,
    {
      // Keep the script's existing settings, only changing what we need
      ...currentScript,
      is_v4_loader: true,
      script: file,
      use_reactor: true,
    },
    apiKey,
    solver,
    customHeaders
  );

  // Poll for the new version number, if was 504
  if (updateResponse.status === 504) {
    await pollVersionNumber(apiKey, project.id, currentScript);
    return;
  }

  // Parse the response, keeping the raw text for error messages
  const responseText = await updateResponse.text();
  const responseBody = parseJson(responseText);

  if (!updateResponse.ok || !responseBody?.success) {
    throw new Error(
      `update failed (HTTP ${updateResponse.status})${formatMessage(
        responseText
      )}`
    );
  }

  // Large scripts are processed in the background, poll until done
  if (responseBody.track_progress) {
    await pollProgress(
      apiKey,
      project.id,
      scriptId,
      responseBody.track_progress
    );
    return;
  }

  console.log(responseBody.message);
}

/**
 * Handles responses, checking mostly for custom errors
 * @param {string} url - The URL to fetch
 * @param {object} options - The fetch options
 * @param {boolean?} ignoreTimeout - Does not error on HTTP Error 504
 * @returns {Promise<Response>} The fetch response
 * @throws {Error} If a custom error is encountered
 */
async function sendFetch(url, options, ignoreTimeout) {
  const response = await stateActionHandler(url, options);

  switch (response.status) {
    // Bad request, usually invalid API key
    case 400:
      throw new Error(
        `400, is your API key valid?${await getResponseMessage(response)}`
      );
    // Forbidden, usually called due to not whitelisting your IP
    case 403:
      throw new Error(
        `403, is your IP whitelisted and is your API key correct?${await getResponseMessage(
          response
        )}`
      );
    // Purposefully ignore Gateway Timeouts, usually due to script upload being too big
    case 504:
      if (!ignoreTimeout) {
        break;
      }
    default:
      break;
  }

  return response;
}

/**
 * Parse JSON, returning `undefined` instead of throwing
 * @param {string} text - The text to parse
 * @returns {any} The parsed value or `undefined` if invalid
 */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parse the `headers` input, a JSON object of header names to values
 * @param {string} input - The raw input
 * @returns {Record<string, string>} The headers, empty if no input
 * @throws {Error} If the input is not a JSON object of strings
 */
function parseHeaders(input) {
  if (!input.trim()) {
    return {};
  }

  const headers = parseJson(input);
  if (
    !headers ||
    typeof headers !== "object" ||
    Array.isArray(headers) ||
    !Object.values(headers).every((value) => typeof value === "string")
  ) {
    throw new Error(
      'headers must be a JSON object of strings, e.g. {"x-header": "value"}'
    );
  }

  return headers;
}

/**
 * Format the server's message from a response body, for appending to errors.
 * HTML error pages are skipped since they are not useful in logs.
 * @param {string} text - The response body
 * @returns {string} ` (message)` or an empty string if there is none
 */
function formatMessage(text) {
  text = text.trim();
  const message =
    parseJson(text)?.message ?? (text.startsWith("<") ? "" : text);
  return message ? ` (${message})` : "";
}

/**
 * Get the server's message from an error response, for appending to errors.
 * @param {Response} response - The fetch response
 * @returns {Promise<string>} ` (message)` or an empty string if there is none
 */
async function getResponseMessage(response) {
  return formatMessage(await response.text().catch(() => ""));
}

/**
 * Fetches the details of the API key
 * @param {string} apiKey - The API key
 * @returns {Promise<object>} The API key details
 */
async function getKeyDetails(apiKey) {
  return await (
    await sendFetch(`https://api.luarmor.net/v3/keys/${apiKey}/details`)
  ).json();
}

/**
 * Resolve a project, given a script id
 * @param {object} details - The entire API key details
 * @param {string} scriptId - The script ID
 * @param {string} [projectId] - The project ID (optional)
 * @returns {object | undefined} The project object or `undefined` if not found
 */
function resolveProject(details, scriptId, projectId = null) {
  if (projectId && projectId !== "") {
    return details.projects.find((project) => project.id === projectId);
  }

  return details.projects.find((project) =>
    project.scripts.some((script) => script.script_id === scriptId)
  );
}

/**
 * Get the script object, given a script id.
 *
 * Returns an object matching the script schema used by the API. Example:
 * {
 *   script_name: 'test',
 *   script_id: 'f731670a759510a40a5a326ea19b8daa',
 *   script_version: '0005',
 *   ffa: false,
 *   silent: false,
 *   heartbeat: true,
 *   lightning: false,
 *   verified: false,
 *   enabled: true,
 *   is_v4_loader: true,
 *   last_edited: 1763917959,
 *   autoupdate: false,
 *   beta_node: false,
 *   v15: false,
 *   autoupdated: false
 * }
 *
 * @param {object} project - The project details
 * @param {string} scriptId - The script ID
 * @returns {{
 *  script_name: string
 *  script_id: string,
 *  script_version: string,
 *  ffa: boolean,
 *  silent: boolean,
 *  heartbeat: boolean,
 *  lightning: boolean,
 *  verified: boolean,
 *  enabled: boolean,
 *  is_v4_loader: boolean,
 *  last_edited: number,
 *  autoupdate: boolean,
 *  beta_node: boolean,
 *  v15: boolean,
 *  autoupdated: boolean
 * } | undefined} The script object or `undefined` if not found
 */
function getScript(project, scriptId) {
  return project.scripts.find((script) => script.script_id === scriptId);
}

/**
 * Poll for the new version number until it changes
 * @param {string} apiKey - The API key
 * @param {string} projectId - The script's project id
 * @param {object} oldScript - The previous script information
 * @returns {Promise<void>}
 */
async function pollVersionNumber(apiKey, projectId, oldScript) {
  const pollInterval = 5000; // 5 seconds

  while (true) {
    // Find the project that contains the script and then get its version
    const details = await getKeyDetails(apiKey);
    const project = resolveProject(details, oldScript.script_id, projectId);
    const newScript = project
      ? getScript(project, oldScript.script_id)
      : undefined;
    const newVersion = newScript?.script_version;

    if (newVersion !== oldScript.script_version) {
      console.log(`New script version: ${newVersion}`);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

/**
 * Poll an update's progress until it completes.
 *
 * Example responses, in order:
 * { success: true, status: 'processing', message: 'Processing..', reactor_status: 'parsing' }
 * { success: true, status: 'processing', message: 'Processing..', reactor_status: 'obfuscating' }
 * { success: true, status: 'completed', message: 'Completed', reactor_status: 'completed',
 *   result: { success: true, message: 'Script updated successfully!', ... } }
 *
 * @param {string} apiKey - The API key
 * @param {string} projectId - The project ID
 * @param {string} scriptId - The script ID
 * @param {string} trackId - The `track_progress` id from the update response
 * @returns {Promise<void>}
 * @throws {Error} If the update fails
 */
async function pollProgress(apiKey, projectId, scriptId, trackId) {
  const pollInterval = 2000; // 2 seconds
  const url = `https://api.luarmor.net/v3/projects/${projectId}/scripts/${scriptId}/progress/${trackId}`;
  let lastStatus;

  while (true) {
    const progress = await (
      await sendFetch(url, { headers: { Authorization: apiKey } })
    ).json();

    if (progress.reactor_status !== lastStatus) {
      console.log(`Progress: ${progress.reactor_status ?? progress.status}`);
      lastStatus = progress.reactor_status;
    }

    if (progress.status === "completed") {
      if (!progress.result?.success) {
        throw new Error(
          `update failed: ${
            progress.result?.message ?? progress.message ?? JSON.stringify(progress)
          }`
        );
      }
      console.log(progress.result.message);
      return;
    }

    if (!progress.success || progress.status !== "processing") {
      throw new Error(
        `update failed: ${progress.message ?? JSON.stringify(progress)}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

/**
 * Update a script
 * @param {string} scriptId - The script ID
 * @param {string} projectId - The project ID
 * @param {Object} scriptData - The data of the script, i.e. ffa, heartbeat, etc.
 * @param {string} apiKey - The API key
 * @param {Solver} [captchaSolver] - The 2captcha solver, skips solving if not given
 * @param {Record<string, string>} [customHeaders] - Extra headers, overriding the defaults
 * @returns {Promise<Response>}
 */
async function updateScript(
  scriptId,
  projectId,
  scriptData,
  apiKey,
  captchaSolver,
  customHeaders = {}
) {
  const pageUrl = `https://api.luarmor.net/v3/projects/${projectId}/scripts/${scriptId}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: apiKey,
  };

  // Attempt to solve the turnstile
  if (captchaSolver) {
    headers["x-turnstile-token"] = await captchaSolver
      .cloudflareTurnstile({
        pageurl: pageUrl,
        sitekey: "0x4AAAAAAA8DOlG4zxR4fbCf",
      })
      .then((x) => x.data);
  }

  // Update the script, returning the response
  return await sendFetch(
    pageUrl,
    {
      method: "PUT",
      headers: { ...headers, ...customHeaders },
      body: JSON.stringify(scriptData),
    },
    true
  );
}

// Run the entrypoint, handling errors
try {
  await run();
} catch (error) {
  setFailed(error.message);
}
