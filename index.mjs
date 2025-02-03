// Dependencies
import * as fs from "fs"
import { setFailed, getInput } from "@actions/core"
import { stateActionHandler } from "fetch-rate-limit-util"

/**
 * The main entry point
 * @returns {Promise<void>}
 * @throws {Error} If the project id cannot be resolved
 */
async function run() {
    // Grab the variables
    const apiKey = getInput("api-key")
    const scriptId = getInput("script-id")
    let projectId = getInput("project-id")
    const filePath = getInput("file")

    // Grab the current details
    const details = await getKeyDetails(apiKey)

    // Resolve the projectId, if it's not specified
    const project = resolveProject(details, scriptId, projectId)
    if (!project) {
        throw new Error("could not find project. invalid projectId or scriptId?")
    }

    // Extract the current version number
    const currentVersion = getScriptVersion(project, scriptId)
    if (!currentVersion) {
        throw new Error("could not get current script version. this should not happen.")
    }

    // Attempt to update the script
    const updateResponse = await updateScript(scriptId, project.id, filePath, apiKey)

    // Poll for the new version number, if was 504
    if (updateResponse.status === 504) {
        await pollVersionNumber(apiKey, scriptId, currentVersion)
    }
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
    const response = await stateActionHandler(url, options)

    switch (response.status) {
        // Bad request, usually invalid API key
        case 400:
            throw new Error("400, is your API key valid?")
        // Forbidden, usually called due to not whitelisting your IP
        case 403:
            throw new Error("403, is your IP whitelisted and is your API key correct?")
        // Purposefully ignore Gateway Timeouts, usually due to script upload being too big
        case 504:
            if (!ignoreTimeout) {
                break
            }
        default:
            break
    }

    return response
}

/**
 * Fetches the details of the API key
 * @param {string} apiKey - The API key
 * @returns {Promise<object>} The API key details
 */
async function getKeyDetails(apiKey) {
    return await (await sendFetch(`https://api.luarmor.net/v3/keys/${apiKey}/details`)).json()
}

/**
 * Resolve a project, given a script id
 * @param {object} details - The entire API key details
 * @param {string} scriptId - The script ID
 * @param {string} [projectId] - The project ID (optional)
 * @returns {string | undefined} The project ID or null if not found
 */
function resolveProject(details, scriptId, projectId = null) {
    if (projectId && projectId !== "") {
        return details.projects.find(project => project.id === projectId)
    }

    return details.projects.find(project => 
        project.scripts.some(script => script.script_id === scriptId)
    )
}

/**
 * Get the script version, given a script id
 * @param {object} project - The project details
 * @param {string} scriptId - The script ID
 * @returns {string | undefined} The script version or null if not found
 */
function getScriptVersion(project, scriptId) {
    return project.scripts.find(script => script.script_id === scriptId)
}

/**
 * Poll for the new version number until it changes
 * @param {string} apiKey - The API key
 * @param {string} scriptId - The script ID
 * @param {string} currentVersion - The current version number
 * @returns {Promise<void>}
 */
async function pollVersionNumber(apiKey, scriptId, currentVersion) {
    const pollInterval = 5000 // 5 seconds

    while (true) {
        const details = await getKeyDetails()
        const newVersion = getScriptVersion(details, scriptId)

        if (newVersion !== currentVersion) {
            console.log(`New script version: ${newVersion}`)
            break
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval))
    }
}

/**
 * Update a script
 * @param {string} scriptId - The script ID
 * @param {string} projectId - The project ID
 * @param {string} filePath - The file path
 * @param {string} apiKey - The API key
 * @returns {Promise<Response>}
 */
async function updateScript(scriptId, projectId, filePath, apiKey) {
    // Read the file
    const file = await fs.promises
        .readFile(filePath)
        .then((data) => data.toString())

    // Update the script, returning the response
    return await sendFetch(`https://api.luarmor.net/v3/projects/${projectId}/scripts/${scriptId}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": apiKey
        },
        body: JSON.stringify({
            script: file
        })
    }, true)
}

// Run the entrypoint, handling errors
try {
    await run()
} catch(error) {
    setFailed(error.message)
}