// Dependencies
import * as fs from "fs"
import { setFailed, getInput } from "@actions/core"
import { stateActionHandler } from "fetch-rate-limit-util"

/**
 * The main entry point
 * @returns {Promise<void>}
 */
async function run() {
    // Grab the variables
    const apiKey = getInput("api-key")
    const scriptId = getInput("script-id")
    let projectId = getInput("project-id")
    const filePath = getInput("file")

    // Resolve the projectId, if it's not specified
    if (projectId === "") {
        projectId = await resolveProjectId(scriptId, apiKey)

        if (projectId === null) {
            throw new Error("failed to resolve project id, invalid script id?")
        }
    }

    // Attempt to update the script
    await updateScript(scriptId, projectId, filePath, apiKey)
}

/**
 * Resolve a project id, given a script id
 * @param {string} scriptId - The script ID
 * @param {string} apiKey - The API key
 * @returns {Promise<string | null>} The project ID or null if not found
 */
async function resolveProjectId(scriptId, apiKey) {
    const details = await (await stateActionHandler(`https://api.luarmor.net/v3/keys/${apiKey}/details`)).json()
    for (const project of details.projects) {
        if (project.scripts.includes(scriptId)) {
            return project.id
        }
    }

    return null
}

/**
 * Update a script
 * @param {string} scriptId - The script ID
 * @param {string} projectId - The project ID
 * @param {string} filePath - The file path
 * @param {string} apiKey - The API key
 * @returns {Promise<void>}
 */
async function updateScript(scriptId, projectId, filePath, apiKey) {
    // Read the file
    const file = await fs.promises
        .readFile(filePath)
        .then((data) => data.toString())

    // Update the script
    await stateActionHandler(`https://api.luarmor.net/v3/projects/${projectId}/scripts/${scriptId}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": apiKey
        },
        body: JSON.stringify({
            script: file
        })
    })
}

// Attempt to run the action, erroring if it fails
try {
    await run()
} catch(error) {
    setFailed(error.message)
}