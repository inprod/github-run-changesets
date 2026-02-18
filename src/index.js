const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

async function pollTask(baseUrl, apiKey, taskId, label, pollingTimeoutSeconds) {
  const pollInterval = 5; // seconds
  const pollUrl = `${baseUrl}/api/v1/task-status/${taskId}/`;
  let elapsed = 0;

  core.info(`${label} dispatched as background task (task_id: ${taskId})`);
  core.info(`Polling for completion (interval: ${pollInterval}s, timeout: ${pollingTimeoutSeconds}s)...`);

  while (elapsed < pollingTimeoutSeconds) {
    await new Promise(resolve => setTimeout(resolve, pollInterval * 1000));
    elapsed += pollInterval;

    try {
      const pollResponse = await fetch(pollUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Api-Key ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!pollResponse.ok) {
        const errorBody = await pollResponse.text();
        throw new Error(
          `Poll failed with status ${pollResponse.status}: ${errorBody || pollResponse.statusText}`
        );
      }

      const pollData = await pollResponse.json();
      core.debug(`Poll response: ${JSON.stringify(pollData)}`);

      const status = pollData.status;
      core.info(`  ${label} status: ${status} (${elapsed}s elapsed)`);

      if (status === 'SUCCESS') {
        core.info(`${label} completed successfully`);
        return { status: 'SUCCESS', result: pollData.result || {} };
      } else if (status === 'FAILURE') {
        const error = pollData.error || 'Unknown error';
        return { status: 'FAILURE', error };
      } else if (status === 'REVOKED') {
        return { status: 'REVOKED' };
      }
      // PENDING, STARTED, RETRY — continue polling
    } catch (e) {
      if (e.message && (e.message.includes('Poll failed'))) {
        throw e;
      }
      core.warning(`Error during polling: ${e.message}. Retrying...`);
      core.debug(`Poll error details: ${e.stack}`);
    }
  }

  return { status: 'TIMEOUT' };
}

function buildUrl(baseUrl, endpoint, environment) {
  const envParam = environment ? `?environment=${encodeURIComponent(environment)}` : '';
  return `${baseUrl}${endpoint}${envParam}`;
}

function getFileFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  return 'yaml'; // .yaml, .yml, or any other extension defaults to yaml
}

function buildYamlPayload(content, variables) {
  // Indent each line of the changeset content for YAML block scalar
  const indentedContent = content.split('\n').map(line => '  ' + line).join('\n');
  let yaml = `changeset: |\n${indentedContent}`;

  if (variables && Object.keys(variables).length > 0) {
    yaml += '\nvariables:';
    for (const [key, value] of Object.entries(variables)) {
      // Quote values to safely handle special YAML characters
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      yaml += `\n  ${key}: "${escaped}"`;
    }
  }

  return yaml;
}

function isGlobPattern(pattern) {
  return /[*?[\]{}]/.test(pattern);
}

function resolveFiles(changesetFile) {
  if (!changesetFile || changesetFile.trim() === '') {
    throw new Error('changeset_file is required');
  }

  if (isGlobPattern(changesetFile)) {
    // Normalize to forward slashes for cross-platform glob compatibility
    const normalizedPattern = changesetFile.replace(/\\/g, '/');
    const matches = globSync(normalizedPattern, { nodir: true });
    if (matches.length === 0) {
      throw new Error(`No files matched the pattern: ${changesetFile}`);
    }
    const filePaths = matches
      .map(f => path.resolve(f))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    core.info(`Matched ${filePaths.length} file(s) for pattern: ${changesetFile}`);
    filePaths.forEach((f, i) => core.info(`  [${i + 1}] ${path.basename(f)}`));
    return filePaths;
  }

  const filePath = path.resolve(changesetFile);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Changeset file not found: ${filePath}`);
  }
  return [filePath];
}

// Validate a single changeset file. Returns { taskId, status, result } or throws.
async function validateFile(filePath, options) {
  const { apiKey, baseUrl, environment, pollingTimeoutSeconds, changesetVariables } = options;
  const content = fs.readFileSync(filePath, 'utf8');
  const format = getFileFormat(filePath);
  const endpoint = format === 'json'
    ? '/api/v1/change-set/change-set/validate_json/'
    : '/api/v1/change-set/change-set/validate_yaml/';
  const validateUrl = buildUrl(baseUrl, endpoint, environment);

  core.debug(`Validate URL: ${validateUrl} (format: ${format})`);

  // Build request body and content type based on file format
  let body, contentType;
  if (format === 'json') {
    contentType = 'application/json';
    const requestPayload = {
      changeset: content,
      ...(changesetVariables && { variables: changesetVariables })
    };
    body = JSON.stringify(requestPayload);
  } else {
    contentType = 'application/yaml';
    body = buildYamlPayload(content, changesetVariables);
  }

  core.debug(`Sending validation request to: ${validateUrl}`);
  let validateResponse;
  try {
    validateResponse = await fetch(validateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${apiKey}`,
        'Content-Type': contentType
      },
      body
    });
    core.debug(`API response status: ${validateResponse.status}`);
  } catch (error) {
    core.error(`Network error connecting to InProd API: ${error.message}`);
    core.debug(`Full error details: ${error.stack}`);
    throw new Error(`Failed to connect to InProd API at ${validateUrl}: ${error.message}`);
  }

  if (!validateResponse.ok) {
    const errorBody = await validateResponse.text();
    throw new Error(
      `Validation request failed with status ${validateResponse.status}: ${errorBody || validateResponse.statusText}`
    );
  }

  const validateData = await validateResponse.json();
  core.debug(`Validate response: ${JSON.stringify(validateData)}`);

  let validateTaskId;
  try {
    validateTaskId = validateData.data.attributes.task_id;
  } catch (e) {
    throw new Error(
      `Failed to extract task_id from validation response. Response: ${JSON.stringify(validateData)}`
    );
  }

  if (!validateTaskId || validateTaskId.trim() === '') {
    throw new Error('Validation API returned an empty task_id');
  }

  const validateResult = await pollTask(baseUrl, apiKey, validateTaskId, 'Validation', pollingTimeoutSeconds);

  if (validateResult.status === 'TIMEOUT') {
    return { taskId: validateTaskId, status: 'TIMEOUT', result: {}, error: `Validation did not complete within ${pollingTimeoutSeconds} seconds` };
  }
  if (validateResult.status === 'FAILURE') {
    return { status: 'FAILURE', result: {}, error: `Validation failed: ${validateResult.error}` };
  }
  if (validateResult.status === 'REVOKED') {
    return { status: 'REVOKED', result: {}, error: 'Validation task was cancelled' };
  }

  const isValid = validateResult.result.is_valid;
  if (!isValid) {
    const validationErrors = JSON.stringify(validateResult.result.validation_results || [], null, 2);
    core.error(`Validation errors:\n${validationErrors}`);
    return { status: 'FAILURE', result: validateResult.result, error: 'Changeset validation failed. See validation errors above.' };
  }

  core.info(`✓ Validation passed`);
  if (validateResult.result.changeset_name) {
    core.info(`  Changeset: ${validateResult.result.changeset_name}`);
  }
  if (validateResult.result.environment) {
    core.info(`  Environment: ${JSON.stringify(validateResult.result.environment)}`);
  }

  return { status: 'SUCCESS', result: validateResult.result };
}

// Execute a single changeset file. Returns { taskId, status, result } or throws.
async function executeFile(filePath, options) {
  const { apiKey, baseUrl, environment, pollingTimeoutSeconds, changesetVariables } = options;
  const content = fs.readFileSync(filePath, 'utf8');
  const format = getFileFormat(filePath);
  const endpoint = format === 'json'
    ? '/api/v1/change-set/change-set/execute_json/'
    : '/api/v1/change-set/change-set/execute_yaml/';
  const executeUrl = buildUrl(baseUrl, endpoint, environment);

  core.debug(`Execute URL: ${executeUrl} (format: ${format})`);

  // Build request body and content type based on file format
  let body, contentType;
  if (format === 'json') {
    contentType = 'application/json';
    const requestPayload = {
      changeset: content,
      ...(changesetVariables && { variables: changesetVariables })
    };
    body = JSON.stringify(requestPayload);
  } else {
    contentType = 'application/yaml';
    body = buildYamlPayload(content, changesetVariables);
  }

  core.debug(`Sending API request to: ${executeUrl}`);
  let executeResponse;
  try {
    executeResponse = await fetch(executeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${apiKey}`,
        'Content-Type': contentType
      },
      body
    });
    core.debug(`API response status: ${executeResponse.status}`);
  } catch (error) {
    core.error(`Network error connecting to InProd API: ${error.message}`);
    core.debug(`Full error details: ${error.stack}`);
    throw new Error(`Failed to connect to InProd API at ${executeUrl}: ${error.message}`);
  }

  if (!executeResponse.ok) {
    const errorBody = await executeResponse.text();
    throw new Error(
      `API request failed with status ${executeResponse.status}: ${errorBody || executeResponse.statusText}`
    );
  }

  const executeData = await executeResponse.json();
  core.debug(`Execute response: ${JSON.stringify(executeData)}`);

  let taskId;
  try {
    taskId = executeData.data.attributes.task_id;
  } catch (e) {
    throw new Error(
      `Failed to extract task_id from API response. Response: ${JSON.stringify(executeData)}`
    );
  }

  if (!taskId || taskId.trim() === '') {
    throw new Error('API returned an empty task_id');
  }

  core.info(`✓ Changeset submitted successfully`);

  const pollResult = await pollTask(baseUrl, apiKey, taskId, 'Execution', pollingTimeoutSeconds);

  if (pollResult.status === 'SUCCESS') {
    core.info(`✓ Changeset executed successfully`);
    return { status: 'SUCCESS', result: pollResult.result };
  } else if (pollResult.status === 'FAILURE') {
    core.error(`✗ Task failed: ${pollResult.error}`);
    return { status: 'FAILURE', result: {}, error: `Changeset execution failed: ${pollResult.error}` };
  } else if (pollResult.status === 'REVOKED') {
    core.warning(`⚠ Task was cancelled/revoked`);
    return { status: 'REVOKED', result: {}, error: 'Changeset execution was cancelled' };
  } else if (pollResult.status === 'TIMEOUT') {
    return { status: 'TIMEOUT', result: {}, error: `Changeset execution did not complete within ${pollingTimeoutSeconds} seconds` };
  }

  return { status: pollResult.status, result: {} };
}

// Process a single file through the full flow (validate + execute).
// Returns { file, status, result }.
async function processSingleFile(filePath, options) {
  const { validateBeforeExecute, validateOnly } = options;
  const fileName = path.basename(filePath);

  core.info(`Read changeset from file: ${fileName}`);

  // Step 1: Validate (if needed)
  if (validateOnly || validateBeforeExecute) {
    core.info('Validating changeset...');
    const valResult = await validateFile(filePath, options);

    if (valResult.status !== 'SUCCESS') {
      return { file: filePath, status: valResult.status, result: valResult.result, error: valResult.error };
    }

    if (validateOnly) {
      return { file: filePath, status: 'SUCCESS', result: valResult.result };
    }
  }

  // Step 2: Execute
  core.info('Submitting changeset for execution...');
  const execResult = await executeFile(filePath, options);

  if (execResult.error) {
    return { file: filePath, status: execResult.status, result: execResult.result, error: execResult.error };
  }

  if (execResult.result.run_id) {
    core.info(`Run ID: ${execResult.result.run_id}`);
  }
  if (execResult.result.changeset_name) {
    core.info(`Changeset: ${execResult.result.changeset_name}`);
  }
  if (execResult.result.environment) {
    core.info(`Environment: ${JSON.stringify(execResult.result.environment)}`);
  }

  return { file: filePath, status: execResult.status, result: execResult.result };
}

const STATUS_PRIORITY = { FAILURE: 0, TIMEOUT: 1, REVOKED: 2, SUBMITTED: 3, SUCCESS: 4 };

function worstStatus(results) {
  return results.reduce((worst, r) => {
    return (STATUS_PRIORITY[r.status] ?? 99) < (STATUS_PRIORITY[worst] ?? 99) ? r.status : worst;
  }, 'SUCCESS');
}

async function run() {
  try {
    // Get inputs (fall back to environment variables for api_key and base_url)
    const apiKey = core.getInput('api_key') || process.env.INPROD_API_KEY || '';
    const baseUrl = (core.getInput('base_url') || process.env.INPROD_BASE_URL || '').replace(/\/$/, '');
    const changesetFile = core.getInput('changeset_file', { required: true });
    const environment = core.getInput('environment');
    const validateBeforeExecute = core.getInput('validate_before_execute') !== 'false';
    const validateOnly = core.getInput('validate_only') === 'true';
    const pollingTimeoutMinutes = parseInt(core.getInput('polling_timeout_minutes'), 10) || 10;
    const pollingTimeoutSeconds = pollingTimeoutMinutes * 60;
    const executionStrategy = core.getInput('execution_strategy') || 'per_file';
    const failFast = core.getInput('fail_fast') === 'true';
    const changesetVariablesInput = core.getInput('changeset_variables');

    // Parse changeset variables from KEY=VALUE format
    let changesetVariables = null;
    if (changesetVariablesInput && changesetVariablesInput.trim()) {
      changesetVariables = {};
      const lines = changesetVariablesInput.trim().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue; // Skip empty lines and comments
        const [key, ...valueParts] = trimmed.split('=');
        if (!key || valueParts.length === 0) {
          throw new Error(`Invalid changeset_variables format. Expected KEY=VALUE on each line, got: ${trimmed}`);
        }
        changesetVariables[key.trim()] = valueParts.join('=').trim(); // Handle values with = in them
      }
      core.debug(`Parsed changeset variables: ${JSON.stringify(Object.keys(changesetVariables))} (values masked)`);
    }

    // Mask sensitive values in logs
    core.setSecret(apiKey);

    // Validate inputs
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('api_key is required and cannot be empty');
    }
    if (!baseUrl || baseUrl.trim() === '') {
      throw new Error('base_url is required and cannot be empty');
    }

    // Validate URL format
    try {
      new URL(baseUrl);
    } catch (e) {
      throw new Error(`Invalid base_url format: ${baseUrl}`);
    }

    // Resolve changeset files
    const filePaths = resolveFiles(changesetFile);

    const options = {
      apiKey, baseUrl, environment, validateBeforeExecute, validateOnly,
      pollingTimeoutSeconds, changesetVariables,
    };

    core.info(`InProd Run Changesets Action v1`);
    core.info(`Base URL: ${baseUrl}`);
    if (environment) {
      core.info(`Target environment: ${environment}`);
    }
    core.info(`Files to process: ${filePaths.length}`);
    core.info(`Execution strategy: ${executionStrategy}`);
    core.info(`Fail fast: ${failFast}`);
    core.info(`Validate before execute: ${validateBeforeExecute}`);
    core.info(`Validate only: ${validateOnly}`);
    core.info(`Polling timeout: ${pollingTimeoutMinutes} minutes (${pollingTimeoutSeconds} seconds)`);
    if (changesetVariables) {
      core.info(`Changeset variables: ${Object.keys(changesetVariables).length} variable(s) provided`);
    }

    const results = [];

    if (executionStrategy === 'validate_first' && !validateOnly && validateBeforeExecute) {
      // Phase 1: Validate all files
      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        const fileName = path.basename(filePath);
        core.info(`\n--- Validating [${i + 1}/${filePaths.length}]: ${fileName} ---`);
        try {
          const valResult = await validateFile(filePath, options);
          if (valResult.status !== 'SUCCESS') {
            results.push({ file: filePath, taskId: valResult.taskId, status: valResult.status, result: valResult.result, error: valResult.error });
            if (failFast) {
              core.error(`Stopping: fail_fast is enabled and ${fileName} failed validation.`);
              break;
            }
            continue;
          }
        } catch (error) {
          results.push({ file: filePath, status: 'FAILURE', result: {}, error: error.message });
          if (failFast) {
            core.error(`Stopping: fail_fast is enabled and ${fileName} failed validation.`);
            break;
          }
          continue;
        }
      }

      // If any validation failed, stop before executing
      const validationFailures = results.filter(r => r.status !== 'SUCCESS');
      if (validationFailures.length > 0) {
        // Set outputs and fail
        core.setOutput('status', 'FAILURE');
        const resultArray = results.map(r => ({
          file: path.basename(r.file),
          status: r.status,
          result: r.result || {},
          error: r.error || null,
        }));
        core.setOutput('result', JSON.stringify(resultArray));
        const msg = validationFailures.length === 1
          ? validationFailures[0].error
          : `${validationFailures.length} of ${filePaths.length} changeset(s) failed validation. See result output for details.`;
        throw new Error(msg);
      }

      core.info(`\n✓ All ${filePaths.length} file(s) passed validation. Starting execution...`);

      // Phase 2: Execute all files (skip re-validation)
      const executeOptions = { ...options, validateBeforeExecute: false, validateOnly: false };
      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        const fileName = path.basename(filePath);
        core.info(`\n--- Executing [${i + 1}/${filePaths.length}]: ${fileName} ---`);
        try {
          const fileResult = await processSingleFile(filePath, executeOptions);
          results.push(fileResult);
          if (fileResult.error && failFast) {
            core.error(`Stopping: fail_fast is enabled and ${fileName} failed.`);
            break;
          }
        } catch (error) {
          results.push({ file: filePath, status: 'FAILURE', result: {}, error: error.message });
          if (failFast) {
            core.error(`Stopping: fail_fast is enabled and ${fileName} failed.`);
            break;
          }
        }
      }
    } else {
      // per_file strategy: full flow for each file sequentially
      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        const fileName = path.basename(filePath);
        core.info(`\n--- Processing [${i + 1}/${filePaths.length}]: ${fileName} ---`);
        try {
          const fileResult = await processSingleFile(filePath, options);
          results.push(fileResult);
          if (fileResult.error && failFast) {
            core.error(`Stopping: fail_fast is enabled and ${fileName} failed.`);
            break;
          }
        } catch (error) {
          results.push({ file: filePath, status: 'FAILURE', result: {}, error: error.message });
          if (failFast) {
            core.error(`Stopping: fail_fast is enabled and ${fileName} failed.`);
            break;
          }
        }
      }
    }

    // Set aggregate outputs
    const aggregateStatus = worstStatus(results);
    core.setOutput('status', aggregateStatus);

    const resultArray = results.map(r => ({
      file: path.basename(r.file),
      status: r.status,
      result: r.result || {},
      error: r.error || null,
    }));
    core.setOutput('result', JSON.stringify(resultArray));

    core.info(`\nAction completed with status: ${aggregateStatus}`);

    // Fail the action if any file had a non-success status
    if (aggregateStatus === 'FAILURE' || aggregateStatus === 'TIMEOUT' || aggregateStatus === 'REVOKED') {
      const failedFiles = results.filter(r => r.status !== 'SUCCESS' && r.status !== 'SUBMITTED');
      const msg = failedFiles.length === 1
        ? failedFiles[0].error
        : `${failedFiles.length} of ${results.length} changeset(s) failed. See result output for details.`;
      throw new Error(msg);
    }

  } catch (error) {
    core.error(`Action failed: ${error.message}`);
    core.debug(`Error stack: ${error.stack}`);
    core.setFailed(error.message);
    process.exit(1);
  }
}

module.exports = { run, pollTask, buildUrl, isGlobPattern, resolveFiles, worstStatus, getFileFormat, buildYamlPayload };

/* istanbul ignore next */
if (require.main === module) {
  run();
}
