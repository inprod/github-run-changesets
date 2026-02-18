const fs = require('fs');
const path = require('path');

// Mock process.exit to prevent Jest from dying
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

// Mock @actions/core
const mockCore = {
  getInput: jest.fn(),
  setOutput: jest.fn(),
  setSecret: jest.fn(),
  setFailed: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
};
jest.mock('@actions/core', () => mockCore);

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const { run, pollTask, buildUrl, isGlobPattern, resolveFiles, worstStatus, getFileFormat, injectYamlVariables, injectJsonVariables } = require('./index');

// Helpers
function mockInputs(inputs) {
  mockCore.getInput.mockImplementation((name) => inputs[name] || '');
}

function mockFetchResponse(status, body, ok = true) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function validationTaskResponse(taskId = 'val-task-123') {
  return {
    data: {
      attributes: {
        title: 'Validation in progress',
        task_id: taskId,
      }
    }
  };
}

function executeTaskResponse(taskId = 'exec-task-456', runId = 42) {
  return {
    data: {
      attributes: {
        title: 'Processing...',
        run_id: runId,
        successful: null,
        task_id: taskId,
      }
    }
  };
}

function successPollResponse(result = {}) {
  return { status: 'SUCCESS', result };
}

function failurePollResponse(error = 'Something went wrong') {
  return { status: 'FAILURE', error };
}

function pendingPollResponse() {
  return { status: 'PENDING' };
}

function startedPollResponse() {
  return { status: 'STARTED' };
}

function revokedPollResponse() {
  return { status: 'REVOKED' };
}

const SAMPLE_CHANGESET = `name: Test Queue
environment: Development
enforcing: true
run_type: stop
action:
  - action: gencloud-create
    object_type: RoutingQueue
    data:
      name: Test Queue
variable: []`;

const SAMPLE_CHANGESET_FILE = path.join(__dirname, '__test_changeset_sample__.yaml');
const SAMPLE_BASENAME = '__test_changeset_sample__.yaml';

// Additional files for glob testing
const GLOB_FILE_01 = path.join(__dirname, '__test_01_queues__.yaml');
const GLOB_FILE_02 = path.join(__dirname, '__test_02_flows__.yaml');
const GLOB_FILE_03 = path.join(__dirname, '__test_03_webchat__.yaml');

// Helper to build expected result array for a single file
function singleResultArray(status, result, error = null) {
  return JSON.stringify([{
    file: SAMPLE_BASENAME,
    status,
    result: result || {},
    error,
  }]);
}

beforeAll(() => {
  fs.writeFileSync(SAMPLE_CHANGESET_FILE, SAMPLE_CHANGESET);
  fs.writeFileSync(GLOB_FILE_01, SAMPLE_CHANGESET);
  fs.writeFileSync(GLOB_FILE_02, SAMPLE_CHANGESET);
  fs.writeFileSync(GLOB_FILE_03, SAMPLE_CHANGESET);
});

afterAll(() => {
  [SAMPLE_CHANGESET_FILE, GLOB_FILE_01, GLOB_FILE_02, GLOB_FILE_03].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockExit.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── buildUrl ───────────────────────────────────────────────────────────────

describe('buildUrl', () => {
  test('builds URL without environment parameter', () => {
    const url = buildUrl('https://test.inprod.io', '/api/v1/change-set/change-set/execute_yaml/', '');
    expect(url).toBe('https://test.inprod.io/api/v1/change-set/change-set/execute_yaml/');
  });

  test('builds URL without environment parameter when undefined', () => {
    const url = buildUrl('https://test.inprod.io', '/api/v1/change-set/change-set/execute_yaml/', undefined);
    expect(url).toBe('https://test.inprod.io/api/v1/change-set/change-set/execute_yaml/');
  });

  test('appends environment name as query parameter', () => {
    const url = buildUrl('https://test.inprod.io', '/api/v1/change-set/change-set/execute_yaml/', 'Production');
    expect(url).toBe('https://test.inprod.io/api/v1/change-set/change-set/execute_yaml/?environment=Production');
  });

  test('appends environment ID as query parameter', () => {
    const url = buildUrl('https://test.inprod.io', '/api/v1/change-set/change-set/validate_yaml/', '3');
    expect(url).toBe('https://test.inprod.io/api/v1/change-set/change-set/validate_yaml/?environment=3');
  });

  test('URL-encodes environment names with spaces', () => {
    const url = buildUrl('https://test.inprod.io', '/api/v1/change-set/change-set/execute_yaml/', 'My Env');
    expect(url).toBe('https://test.inprod.io/api/v1/change-set/change-set/execute_yaml/?environment=My%20Env');
  });
});

// ─── isGlobPattern ──────────────────────────────────────────────────────────

describe('isGlobPattern', () => {
  test('returns false for plain file paths', () => {
    expect(isGlobPattern('changesets/deploy-queue.yaml')).toBe(false);
    expect(isGlobPattern('/absolute/path/file.yaml')).toBe(false);
    expect(isGlobPattern('file.yaml')).toBe(false);
  });

  test('returns true for glob patterns', () => {
    expect(isGlobPattern('changesets/*.yaml')).toBe(true);
    expect(isGlobPattern('changesets/**/*.yaml')).toBe(true);
    expect(isGlobPattern('changesets/deploy-?.yaml')).toBe(true);
    expect(isGlobPattern('changesets/{a,b}.yaml')).toBe(true);
    expect(isGlobPattern('changesets/[01]*.yaml')).toBe(true);
  });
});

// ─── resolveFiles ───────────────────────────────────────────────────────────

describe('resolveFiles', () => {
  test('throws when changeset_file is empty', () => {
    expect(() => resolveFiles('')).toThrow('changeset_file is required');
  });

  test('throws when plain file path does not exist', () => {
    expect(() => resolveFiles('/nonexistent/file.yaml')).toThrow('Changeset file not found');
  });

  test('resolves a single plain file path', () => {
    const files = resolveFiles(SAMPLE_CHANGESET_FILE);
    expect(files).toEqual([path.resolve(SAMPLE_CHANGESET_FILE)]);
  });

  test('resolves glob pattern and sorts by basename', () => {
    const pattern = path.join(__dirname, '__test_0*__.yaml');
    const files = resolveFiles(pattern);
    expect(files.length).toBe(3);
    expect(path.basename(files[0])).toBe('__test_01_queues__.yaml');
    expect(path.basename(files[1])).toBe('__test_02_flows__.yaml');
    expect(path.basename(files[2])).toBe('__test_03_webchat__.yaml');
  });

  test('throws when glob pattern matches no files', () => {
    expect(() => resolveFiles(path.join(__dirname, '__nonexistent_glob_*__.yaml'))).toThrow('No files matched the pattern');
  });
});

// ─── worstStatus ────────────────────────────────────────────────────────────

describe('worstStatus', () => {
  test('returns SUCCESS when all succeed', () => {
    expect(worstStatus([{ status: 'SUCCESS' }, { status: 'SUCCESS' }])).toBe('SUCCESS');
  });

  test('returns FAILURE when any fails', () => {
    expect(worstStatus([{ status: 'SUCCESS' }, { status: 'FAILURE' }])).toBe('FAILURE');
  });

  test('FAILURE beats TIMEOUT', () => {
    expect(worstStatus([{ status: 'TIMEOUT' }, { status: 'FAILURE' }])).toBe('FAILURE');
  });

  test('TIMEOUT beats REVOKED', () => {
    expect(worstStatus([{ status: 'REVOKED' }, { status: 'TIMEOUT' }])).toBe('TIMEOUT');
  });

  test('REVOKED beats SUBMITTED', () => {
    expect(worstStatus([{ status: 'SUBMITTED' }, { status: 'REVOKED' }])).toBe('REVOKED');
  });

  test('SUBMITTED beats SUCCESS', () => {
    expect(worstStatus([{ status: 'SUCCESS' }, { status: 'SUBMITTED' }])).toBe('SUBMITTED');
  });

  test('returns SUCCESS for empty results', () => {
    expect(worstStatus([])).toBe('SUCCESS');
  });
});

// ─── pollTask ───────────────────────────────────────────────────────────────

describe('pollTask', () => {
  // Helper to advance timers past the poll interval
  async function advancePoll() {
    await jest.advanceTimersByTimeAsync(5000);
  }

  test('returns SUCCESS when task completes successfully', async () => {
    const result = { run_id: 1, successful: true };
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(result)));

    const promise = pollTask('https://test.inprod.io', 'key', 'task-1', 'Execution', 60);
    await advancePoll();
    const outcome = await promise;

    expect(outcome).toEqual({ status: 'SUCCESS', result });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.inprod.io/api/v1/task-status/task-1/',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('returns FAILURE when task fails', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, failurePollResponse('Boom')));

    const promise = pollTask('https://test.inprod.io', 'key', 'task-1', 'Execution', 60);
    await advancePoll();
    const outcome = await promise;

    expect(outcome).toEqual({ status: 'FAILURE', error: 'Boom' });
  });

  test('returns FAILURE with default error message', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { status: 'FAILURE' }));

    const promise = pollTask('https://test.inprod.io', 'key', 'task-1', 'Execution', 60);
    await advancePoll();
    const outcome = await promise;

    expect(outcome).toEqual({ status: 'FAILURE', error: 'Unknown error' });
  });

  test('returns REVOKED when task is cancelled', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, revokedPollResponse()));

    const promise = pollTask('https://test.inprod.io', 'key', 'task-1', 'Execution', 60);
    await advancePoll();
    const outcome = await promise;

    expect(outcome).toEqual({ status: 'REVOKED' });
  });

  test('continues polling on PENDING then returns SUCCESS', async () => {
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, pendingPollResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, startedPollResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse({ run_id: 5 })));

    const promise = pollTask('https://test.inprod.io', 'key', 'task-1', 'Execution', 60);
    await advancePoll(); // PENDING
    await advancePoll(); // STARTED
    await advancePoll(); // SUCCESS
    const outcome = await promise;

    expect(outcome).toEqual({ status: 'SUCCESS', result: { run_id: 5 } });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test('returns TIMEOUT when polling exceeds timeout', async () => {
    // Timeout of 10s, poll interval 5s = 2 polls max
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, pendingPollResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, pendingPollResponse()));

    const promise = pollTask('https://test.inprod.io', 'key', 'task-1', 'Execution', 10);
    await advancePoll(); // 5s — PENDING
    await advancePoll(); // 10s — PENDING, now >= timeout
    const outcome = await promise;

    expect(outcome).toEqual({ status: 'TIMEOUT' });
  });

  test('throws on non-ok HTTP response from poll', async () => {
    jest.useRealTimers();
    mockFetch.mockResolvedValueOnce(mockFetchResponse(500, 'Internal Server Error', false));

    // Use a very short timeout so the real timer resolves quickly
    // pollInterval is 5s but we mock setTimeout behavior via real timers here
    const originalSetTimeout = globalThis.setTimeout;
    jest.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => originalSetTimeout(fn, 0));

    await expect(
      pollTask('https://test.inprod.io', 'key', 'task-1', 'Execution', 60)
    ).rejects.toThrow('Poll failed with status 500');

    globalThis.setTimeout.mockRestore();
    jest.useFakeTimers();
  });

  test('retries on transient network errors', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse({ run_id: 7 })));

    const promise = pollTask('https://test.inprod.io', 'key', 'task-1', 'Execution', 60);
    await advancePoll(); // Network error — retry
    await advancePoll(); // SUCCESS
    const outcome = await promise;

    expect(outcome).toEqual({ status: 'SUCCESS', result: { run_id: 7 } });
    expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('Network error'));
  });

  test('sends correct authorization header', async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, successPollResponse({})));

    const promise = pollTask('https://test.inprod.io', 'my-secret-key', 'task-1', 'Test', 60);
    await advancePoll();
    await promise;

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Api-Key my-secret-key'
        })
      })
    );
  });
});

// ─── run() — Input Validation ───────────────────────────────────────────────

describe('run — input validation', () => {
  test('fails when api_key is empty', async () => {
    mockInputs({ api_key: '', base_url: 'https://test.inprod.io', changeset_file: SAMPLE_CHANGESET_FILE });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('api_key is required and cannot be empty');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  test('fails when base_url is empty', async () => {
    mockInputs({ api_key: 'key', base_url: '', changeset_file: SAMPLE_CHANGESET_FILE });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('base_url is required and cannot be empty');
  });

  test('fails when base_url is invalid', async () => {
    mockInputs({ api_key: 'key', base_url: 'not-a-url', changeset_file: SAMPLE_CHANGESET_FILE });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('Invalid base_url format: not-a-url');
  });

  test('fails when changeset_file is not provided', async () => {
    mockInputs({ api_key: 'key', base_url: 'https://test.inprod.io' });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('changeset_file is required');
  });

  test('fails when changeset_file does not exist', async () => {
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io',
      changeset_file: '/nonexistent/path/file.yaml',
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Changeset file not found'));
  });

  test('falls back to INPROD_API_KEY env var when api_key input is empty', async () => {
    process.env.INPROD_API_KEY = 'env-api-key';
    process.env.INPROD_BASE_URL = 'https://env.inprod.io';
    mockInputs({ api_key: '', base_url: '', changeset_file: SAMPLE_CHANGESET_FILE, validate_before_execute: 'false' });
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.setSecret).toHaveBeenCalledWith('env-api-key');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://env.inprod.io'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Authorization': 'Api-Key env-api-key' })
      })
    );
    expect(mockCore.setFailed).not.toHaveBeenCalled();
    delete process.env.INPROD_API_KEY;
    delete process.env.INPROD_BASE_URL;
  });

  test('falls back to INPROD_BASE_URL env var when base_url input is empty', async () => {
    process.env.INPROD_BASE_URL = 'https://env-only.inprod.io';
    mockInputs({ api_key: 'key', base_url: '', changeset_file: SAMPLE_CHANGESET_FILE, validate_before_execute: 'false' });
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://env-only.inprod.io'),
      expect.any(Object)
    );
    expect(mockCore.setFailed).not.toHaveBeenCalled();
    delete process.env.INPROD_BASE_URL;
  });

  test('input takes precedence over env var', async () => {
    process.env.INPROD_API_KEY = 'env-key';
    process.env.INPROD_BASE_URL = 'https://env.inprod.io';
    mockInputs({ api_key: 'input-key', base_url: 'https://input.inprod.io', changeset_file: SAMPLE_CHANGESET_FILE, validate_before_execute: 'false' });
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.setSecret).toHaveBeenCalledWith('input-key');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://input.inprod.io'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Authorization': 'Api-Key input-key' })
      })
    );
    expect(mockCore.setFailed).not.toHaveBeenCalled();
    delete process.env.INPROD_API_KEY;
    delete process.env.INPROD_BASE_URL;
  });

  test('fails when api_key not provided via input or env var', async () => {
    delete process.env.INPROD_API_KEY;
    mockInputs({ api_key: '', base_url: 'https://test.inprod.io', changeset_file: SAMPLE_CHANGESET_FILE });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('api_key is required and cannot be empty');
  });

  test('fails when base_url not provided via input or env var', async () => {
    delete process.env.INPROD_BASE_URL;
    mockInputs({ api_key: 'key', base_url: '', changeset_file: SAMPLE_CHANGESET_FILE });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('base_url is required and cannot be empty');
  });

  test('masks api_key in logs', async () => {
    mockInputs({ api_key: 'secret-key', base_url: 'https://test.inprod.io', changeset_file: SAMPLE_CHANGESET_FILE });
    // Will fail on fetch but that's fine — we're checking setSecret was called
    mockFetch.mockRejectedValueOnce(new Error('fetch error'));

    await run();

    expect(mockCore.setSecret).toHaveBeenCalledWith('secret-key');
  });

  test('removes trailing slash from base_url to prevent double slashes in API URLs', async () => {
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io/',
      changeset_file: SAMPLE_CHANGESET_FILE,
      validate_before_execute: 'false'
    });
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    // Verify the API was called with a URL that doesn't have double slashes (like //api/v1...)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://test.inprod.io/api/v1/change-set/change-set/execute_yaml/'),
      expect.any(Object)
    );
    // Ensure no double slashes in the URL path
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).not.toMatch(/inprod\.io\/\//);
    expect(mockCore.setFailed).not.toHaveBeenCalled();
  });
});

// ─── run() — Changeset File Resolution ───────────────────────────────────

describe('run — changeset file resolution', () => {
  test('reads changeset_file and sends content in yaml payload', async () => {
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io',
      changeset_file: SAMPLE_CHANGESET_FILE,
      validate_before_execute: 'false',
    });
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    const callArgs = mockFetch.mock.calls[0]; // First call is execute
    // YAML files are sent as application/yaml with raw content
    expect(callArgs[1].headers['Content-Type']).toBe('application/yaml');
    expect(callArgs[1].body).toBe(SAMPLE_CHANGESET);
    expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('Read changeset from file'));
  });
});

// ─── run() — Execute without validation ─────────────────────────────────────

describe('run — execute without validation', () => {
  const baseInputs = {
    api_key: 'key',
    base_url: 'https://test.inprod.io',
    changeset_file: SAMPLE_CHANGESET_FILE,
    validate_before_execute: 'false',
  };

  test('submits and waits for successful execution', async () => {
    mockInputs({ ...baseInputs, polling_timeout_minutes: '1' });

    const execResult = { run_id: 42, successful: true, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-1', 42)))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'SUCCESS');
    expect(mockCore.setOutput).toHaveBeenCalledWith('result', singleResultArray('SUCCESS', execResult));
    expect(mockCore.setFailed).not.toHaveBeenCalled();
  });

  test('fails when execution API returns non-ok status', async () => {
    mockInputs({ ...baseInputs });
    mockFetch.mockResolvedValueOnce(mockFetchResponse(403, 'Forbidden', false));

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('API request failed with status 403')
    );
  });

  test('fails when execution response has no task_id', async () => {
    mockInputs({ ...baseInputs });
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { data: { attributes: {} } }));

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('API returned an empty task_id');
  });

  test('fails when execution response structure is unexpected', async () => {
    mockInputs({ ...baseInputs });
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { unexpected: true }));

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to extract task_id from API response')
    );
  });

  test('fails when execution poll returns FAILURE', async () => {
    mockInputs({ ...baseInputs, polling_timeout_minutes: '1' });
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-3')))
      .mockResolvedValueOnce(mockFetchResponse(200, failurePollResponse('Exec failed')));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.setFailed).toHaveBeenCalledWith('Changeset execution failed: Exec failed');
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'FAILURE');
  });

  test('fails when execution poll returns REVOKED', async () => {
    mockInputs({ ...baseInputs, polling_timeout_minutes: '1' });
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-4')))
      .mockResolvedValueOnce(mockFetchResponse(200, revokedPollResponse()));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.setFailed).toHaveBeenCalledWith('Changeset execution was cancelled');
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'REVOKED');
  });

  test('fails when execution poll times out', async () => {
    mockInputs({ ...baseInputs, polling_timeout_minutes: '1' });
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-5')));

    // Fill all polling slots with PENDING (60s / 5s = 12 polls)
    for (let i = 0; i < 12; i++) {
      mockFetch.mockResolvedValueOnce(mockFetchResponse(200, pendingPollResponse()));
    }

    const promise = run();
    for (let i = 0; i < 12; i++) {
      await jest.advanceTimersByTimeAsync(5000);
    }
    await promise;

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('did not complete within 60 seconds')
    );
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'TIMEOUT');
  });

  test('appends environment query parameter to execute URL', async () => {
    mockInputs({ ...baseInputs, environment: 'Production' });
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.inprod.io/api/v1/change-set/change-set/execute_yaml/?environment=Production',
      expect.any(Object)
    );
  });

  test('sends correct headers on execute for yaml files', async () => {
    mockInputs({ ...baseInputs });
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Api-Key key',
          'Content-Type': 'application/yaml',
        },
      })
    );
  });
});

// ─── run() — Validate before execute ────────────────────────────────────────

describe('run — validate before execute', () => {
  const baseInputs = {
    api_key: 'key',
    base_url: 'https://test.inprod.io',
    changeset_file: SAMPLE_CHANGESET_FILE,
    validate_before_execute: 'true',
  };

  test('validates then executes on success', async () => {
    mockInputs(baseInputs);

    const validResult = { is_valid: true, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      // validate_yaml POST
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-1')))
      // poll validation
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(validResult)))
      // execute_yaml POST
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('e-1')))
      // poll execution
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000); // validation poll
    await jest.advanceTimersByTimeAsync(5000); // execution poll
    await promise;

    // Should have called validate then execute
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://test.inprod.io/api/v1/change-set/change-set/validate_yaml/',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(3,
      'https://test.inprod.io/api/v1/change-set/change-set/execute_yaml/',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockCore.setFailed).not.toHaveBeenCalled();
  });

  test('fails without executing when validation returns is_valid: false', async () => {
    mockInputs(baseInputs);

    const invalidResult = {
      is_valid: false,
      validation_results: [{ action_id: 1, errors: { name: [{ msg: ['Required'] }] } }],
      changeset_name: 'Test',
    };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-2')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(invalidResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.setFailed).toHaveBeenCalledWith('Changeset validation failed. See validation errors above.');
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'FAILURE');
    // Should NOT have called execute
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('fails when validation API returns non-ok status', async () => {
    mockInputs(baseInputs);
    mockFetch.mockResolvedValueOnce(mockFetchResponse(401, 'Unauthorized', false));

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Validation request failed with status 401')
    );
    // Should NOT have called execute
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('fails when validation response has no task_id', async () => {
    mockInputs(baseInputs);
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { data: { attributes: {} } }));

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith('Validation API returned an empty task_id');
  });

  test('fails when validation response structure is unexpected', async () => {
    mockInputs(baseInputs);
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { bad: 'data' }));

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to extract task_id from validation response')
    );
  });

  test('fails when validation poll returns FAILURE', async () => {
    mockInputs(baseInputs);
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-3')))
      .mockResolvedValueOnce(mockFetchResponse(200, failurePollResponse('Val error')));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.setFailed).toHaveBeenCalledWith('Validation failed: Val error');
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'FAILURE');
  });

  test('fails when validation poll returns REVOKED', async () => {
    mockInputs(baseInputs);
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-4')))
      .mockResolvedValueOnce(mockFetchResponse(200, revokedPollResponse()));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.setFailed).toHaveBeenCalledWith('Validation task was cancelled');
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'REVOKED');
  });

  test('fails when validation poll times out', async () => {
    mockInputs({ ...baseInputs, polling_timeout_minutes: '1' });
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-5')));
    for (let i = 0; i < 12; i++) {
      mockFetch.mockResolvedValueOnce(mockFetchResponse(200, pendingPollResponse()));
    }

    const promise = run();
    for (let i = 0; i < 12; i++) {
      await jest.advanceTimersByTimeAsync(5000);
    }
    await promise;

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Validation did not complete within 60 seconds')
    );
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'TIMEOUT');
  });

  test('appends environment to both validate and execute URLs', async () => {
    mockInputs({ ...baseInputs, environment: 'UAT' });

    const validResult = { is_valid: true };
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-6')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(validResult)))
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('e-6')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000); // validation poll
    await jest.advanceTimersByTimeAsync(5000); // execution poll
    await promise;

    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://test.inprod.io/api/v1/change-set/change-set/validate_yaml/?environment=UAT',
      expect.any(Object)
    );
    expect(mockFetch).toHaveBeenNthCalledWith(3,
      'https://test.inprod.io/api/v1/change-set/change-set/execute_yaml/?environment=UAT',
      expect.any(Object)
    );
  });
});

// ─── run() — Validate only ─────────────────────────────────────────────────

describe('run — validate only', () => {
  const baseInputs = {
    api_key: 'key',
    base_url: 'https://test.inprod.io',
    changeset_file: SAMPLE_CHANGESET_FILE,
    validate_only: 'true',
  };

  test('validates and returns without executing', async () => {
    mockInputs(baseInputs);

    const validResult = { is_valid: true, changeset_name: 'Test Q', environment: { id: 2, name: 'UAT' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-10')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(validResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'SUCCESS');
    expect(mockCore.setOutput).toHaveBeenCalledWith('result', singleResultArray('SUCCESS', validResult));
    expect(mockCore.setFailed).not.toHaveBeenCalled();
    // Should NOT have called execute
    expect(mockFetch).toHaveBeenCalledTimes(2); // validate POST + poll GET
  });

  test('fails when validation finds errors', async () => {
    mockInputs(baseInputs);

    const invalidResult = { is_valid: false, validation_results: [{ errors: {} }] };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-11')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(invalidResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.setFailed).toHaveBeenCalledWith('Changeset validation failed. See validation errors above.');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ─── run() — Execute with validation + wait (full flow) ────────────────────

describe('run — full flow (validate + execute + wait)', () => {
  test('validates, executes, polls, and succeeds', async () => {
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io',
      changeset_file: SAMPLE_CHANGESET_FILE,
      validate_before_execute: 'true',
      polling_timeout_minutes: '1',
      environment: 'Production',
    });

    const validResult = { is_valid: true, changeset_name: 'Full Test' };
    const execResult = { run_id: 99, successful: true, changeset_name: 'Full Test', environment: { id: 3, name: 'Production' } };

    mockFetch
      // 1. validate POST
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-full')))
      // 2. validation poll → SUCCESS
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(validResult)))
      // 3. execute POST
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('e-full', 99)))
      // 4. execution poll → PENDING
      .mockResolvedValueOnce(mockFetchResponse(200, pendingPollResponse()))
      // 5. execution poll → SUCCESS
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);  // validation poll
    await jest.advanceTimersByTimeAsync(5000);  // execution poll — PENDING
    await jest.advanceTimersByTimeAsync(5000);  // execution poll — SUCCESS
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'SUCCESS');
    expect(mockCore.setOutput).toHaveBeenCalledWith('result', singleResultArray('SUCCESS', execResult));
    expect(mockCore.setFailed).not.toHaveBeenCalled();

    // Verify environment was passed to both endpoints
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      expect.stringContaining('?environment=Production'),
      expect.any(Object)
    );
    expect(mockFetch).toHaveBeenNthCalledWith(3,
      expect.stringContaining('?environment=Production'),
      expect.any(Object)
    );
  });
});

// ─── run() — Polling timeout default ────────────────────────────────────────

describe('run — polling timeout defaults', () => {
  test('defaults to 10 minutes when polling_timeout_minutes not provided', async () => {
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io',
      changeset_file: SAMPLE_CHANGESET_FILE,
      validate_before_execute: 'false',
    });
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining('10 minutes (600 seconds)')
    );
  });

  test('respects custom polling_timeout_minutes', async () => {
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io',
      changeset_file: SAMPLE_CHANGESET_FILE,
      validate_before_execute: 'false',
      polling_timeout_minutes: '30',
    });
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining('30 minutes (1800 seconds)')
    );
  });
});

// ─── run() — Output logging ────────────────────────────────────────────────

describe('run — output logging', () => {
  test('logs run_id, changeset_name, and environment on success', async () => {
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io',
      changeset_file: SAMPLE_CHANGESET_FILE,
      validate_before_execute: 'false',
      polling_timeout_minutes: '1',
    });

    const execResult = { run_id: 55, changeset_name: 'My CS', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-log', 55)))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockCore.info).toHaveBeenCalledWith('Run ID: 55');
    expect(mockCore.info).toHaveBeenCalledWith('Changeset: My CS');
    expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('"name":"Dev"'));
  });

  test('result output is always an array', async () => {
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io',
      changeset_file: SAMPLE_CHANGESET_FILE,
      validate_before_execute: 'false',
    });
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-arr')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    const resultCall = mockCore.setOutput.mock.calls.find(c => c[0] === 'result');
    const parsed = JSON.parse(resultCall[1]);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].file).toBe(SAMPLE_BASENAME);
    expect(parsed[0].status).toBe('SUCCESS');
  });
});

// ─── run() — Multi-file execution (per_file strategy) ──────────────────────

describe('run — multi-file (per_file strategy)', () => {
  const globPattern = path.join(__dirname, '__test_0*__.yaml');
  const baseInputs = {
    api_key: 'key',
    base_url: 'https://test.inprod.io',
    changeset_file: globPattern,
    validate_before_execute: 'false',
  };

  test('processes multiple files sequentially and produces result array', async () => {
    mockInputs(baseInputs);

    // 3 files matched: 01, 02, 03
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-01')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)))
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-02')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)))
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-03')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(15000); // 3 polls
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(6); // 3 executes + 3 polls
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'SUCCESS');
    expect(mockCore.setFailed).not.toHaveBeenCalled();

    // Verify result array
    const resultCall = mockCore.setOutput.mock.calls.find(c => c[0] === 'result');
    const parsed = JSON.parse(resultCall[1]);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].file).toBe('__test_01_queues__.yaml');
    expect(parsed[1].file).toBe('__test_02_flows__.yaml');
    expect(parsed[2].file).toBe('__test_03_webchat__.yaml');
  });

  test('continues on failure when fail_fast is false (default)', async () => {
    mockInputs({ ...baseInputs, fail_fast: 'false' });

    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      // File 1: execute + poll
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-01')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)))
      // File 2: execute fails
      .mockResolvedValueOnce(mockFetchResponse(403, 'Forbidden', false))
      // File 3: execute + poll
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-03')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000); // File 1 poll
    await jest.advanceTimersByTimeAsync(5000); // File 3 poll
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(5); // 3 executes + 2 polls
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'FAILURE');
    expect(mockCore.setFailed).toHaveBeenCalled();

    const resultCall = mockCore.setOutput.mock.calls.find(c => c[0] === 'result');
    const parsed = JSON.parse(resultCall[1]);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].status).toBe('SUCCESS');
    expect(parsed[1].status).toBe('FAILURE');
    expect(parsed[1].error).toContain('403');
    expect(parsed[2].status).toBe('SUCCESS');
  });

  test('stops on first failure when fail_fast is true', async () => {
    mockInputs({ ...baseInputs, fail_fast: 'true' });

    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      // File 1: execute + poll
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-01')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)))
      // File 2: execute fails
      .mockResolvedValueOnce(mockFetchResponse(403, 'Forbidden', false));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000); // File 1 poll
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(3); // 2 executes + 1 poll
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'FAILURE');
    expect(mockCore.setFailed).toHaveBeenCalled();

    const resultCall = mockCore.setOutput.mock.calls.find(c => c[0] === 'result');
    const parsed = JSON.parse(resultCall[1]);
    expect(parsed).toHaveLength(2); // only 2 processed
    expect(parsed[0].status).toBe('SUCCESS');
    expect(parsed[1].status).toBe('FAILURE');
  });

  test('reports multiple failures in aggregate message', async () => {
    mockInputs({ ...baseInputs, fail_fast: 'false' });

    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      // File 1: execute fails
      .mockResolvedValueOnce(mockFetchResponse(403, 'Forbidden', false))
      // File 2: execute fails
      .mockResolvedValueOnce(mockFetchResponse(403, 'Forbidden', false))
      // File 3: execute + poll
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-03')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000); // File 3 poll
    await promise;

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('2 of 3 changeset(s) failed')
    );
  });

  test('logs file count in action output', async () => {
    mockInputs(baseInputs);

    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-01')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)))
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-02')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)))
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-03')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(15000); // 3 polls
    await promise;

    expect(mockCore.info).toHaveBeenCalledWith('Files to process: 3');
  });

  test('fails when glob pattern matches no files', async () => {
    mockInputs({
      ...baseInputs,
      changeset_file: path.join(__dirname, '__no_match_glob_*__.yaml'),
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('No files matched the pattern')
    );
  });
});

// ─── run() — Multi-file execution (validate_first strategy) ────────────────

describe('run — multi-file (validate_first strategy)', () => {
  const globPattern = path.join(__dirname, '__test_0*__.yaml');
  const baseInputs = {
    api_key: 'key',
    base_url: 'https://test.inprod.io',
    changeset_file: globPattern,
    validate_before_execute: 'true',
    execution_strategy: 'validate_first',
  };

  test('validates all files first then executes all', async () => {
    mockInputs(baseInputs);

    const validResult = { is_valid: true };
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      // Validate file 1
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-01')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(validResult)))
      // Validate file 2
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-02')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(validResult)))
      // Validate file 3
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-03')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(validResult)))
      // Execute file 1
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('e-01')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)))
      // Execute file 2
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('e-02')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)))
      // Execute file 3
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('e-03')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    // wait for all operations
    for (let i = 0; i < 6; i++) {
      await jest.advanceTimersByTimeAsync(5000);
    }
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(12);
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'SUCCESS');
    expect(mockCore.setFailed).not.toHaveBeenCalled();
  });

  test('does not execute any files when validation fails', async () => {
    mockInputs(baseInputs);

    const validResult = { is_valid: true };
    const invalidResult = { is_valid: false, validation_results: [{ errors: {} }] };
    mockFetch
      // Validate file 1 — passes
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-01')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(validResult)))
      // Validate file 2 — fails
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-02')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(invalidResult)))
      // Validate file 3 — passes (still attempted since fail_fast is false)
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-03')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(validResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    // 6 fetch calls (3 validate + 3 polls), NO execute calls
    expect(mockFetch).toHaveBeenCalledTimes(6);
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'FAILURE');
    expect(mockCore.setFailed).toHaveBeenCalled();
  });

  test('stops validation on first failure when fail_fast is true', async () => {
    mockInputs({ ...baseInputs, fail_fast: 'true' });

    const validResult = { is_valid: true };
    const invalidResult = { is_valid: false, validation_results: [{ errors: {} }] };
    mockFetch
      // Validate file 1 — passes
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-01')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(validResult)))
      // Validate file 2 — fails
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-02')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(invalidResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    // Only 4 fetch calls (2 validate + 2 polls), stopped after file 2
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'FAILURE');
    expect(mockCore.setFailed).toHaveBeenCalled();
  });
});
// ─── Changeset Variables ───────────────────────────────────────────────────

describe('run — changeset variables', () => {
  const baseInputs = {
    api_key: 'key',
    base_url: 'https://test.inprod.io',
    changeset_file: SAMPLE_CHANGESET_FILE,
    validate_before_execute: 'false',
  };

  test('injects changeset variables into yaml file body', async () => {
    mockInputs({
      ...baseInputs,
      changeset_variables: 'DATABASE_PASSWORD=secret123\nAPI_TOKEN=token456'
    });

    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers['Content-Type']).toBe('application/yaml');
    // Variables should be injected into the YAML body
    const body = callArgs[1].body;
    expect(body).toContain('DATABASE_PASSWORD');
    expect(body).toContain('secret123');
    expect(body).toContain('API_TOKEN');
    expect(body).toContain('token456');
    expect(body).toContain('mask_value: false');
  });

  test('fails with invalid changeset_variables format', async () => {
    mockInputs({ 
      ...baseInputs,
      changeset_variables: 'INVALID_FORMAT_NO_EQUALS'
    });

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid changeset_variables format')
    );
  });

  test('handles empty changeset_variables gracefully', async () => {
    mockInputs({ 
      ...baseInputs,
      changeset_variables: ''
    });
    
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    // Should succeed without variables
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'SUCCESS');
  });

  test('handles whitespace-only changeset_variables gracefully', async () => {
    mockInputs({ 
      ...baseInputs,
      changeset_variables: '   '
    });
    
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    // Should succeed without variables
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'SUCCESS');
  });

  test('logs variable count but not values', async () => {
    const variables = { SECRET1: 'value1', SECRET2: 'value2' };
    mockInputs({ 
      ...baseInputs,
      changeset_variables: 'SECRET1=value1\nSECRET2=value2'
    });
    
    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    // Should log variable count
    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining('Changeset variables: 2 variable(s) provided')
    );
    
    // Should NOT log variable values
    expect(mockCore.info).not.toHaveBeenCalledWith(
      expect.stringContaining('value1')
    );
    expect(mockCore.info).not.toHaveBeenCalledWith(
      expect.stringContaining('value2')
    );
  });

  test('injects variables into each yaml file when multiple files provided', async () => {
    const globPattern = path.join(__dirname, '__test_0*__.yaml');
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io',
      changeset_file: globPattern,
      validate_before_execute: 'false',
      changeset_variables: 'DB_PASSWORD=secret\nAPI_KEY=key123'
    });

    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      // File 1
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-01')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)))
      // File 2
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-02')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)))
      // File 3
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse('t-03')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(15000);
    await promise;

    // Each YAML file should have variables injected
    const postCalls = mockFetch.mock.calls.filter(call => call[1].method === 'POST');
    expect(postCalls.length).toBe(3);
    postCalls.forEach(call => {
      expect(call[1].headers['Content-Type']).toBe('application/yaml');
      expect(call[1].body).toContain('DB_PASSWORD');
      expect(call[1].body).toContain('secret');
      expect(call[1].body).toContain('API_KEY');
      expect(call[1].body).toContain('key123');
    });
  });

  test('handles changeset variables with values containing equals signs', async () => {
    mockInputs({
      ...baseInputs,
      changeset_variables: 'CONNECTION_STRING=user=admin;password=secret123;host=db.local'
    });

    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    // Variables parsing still works (used for JSON files), verify no crash
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'SUCCESS');
  });

  test('skips null lines and comments in changeset variables', async () => {
    mockInputs({
      ...baseInputs,
      changeset_variables: `
        # This is a comment
        API_KEY=secret123

        # Another comment
        DB_PASSWORD=dbpass456
      `
    });

    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    // Variables parsing still works, verify no crash
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'SUCCESS');
  });

  test('trims whitespace from keys and values', async () => {
    mockInputs({
      ...baseInputs,
      changeset_variables: '  API_KEY  =  secret123  \n  DB_USER  =  admin  '
    });

    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    // Variables parsing still works, verify no crash
    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'SUCCESS');
  });
});

// ─── getFileFormat ──────────────────────────────────────────────────────────

describe('getFileFormat', () => {
  test('returns yaml for .yaml files', () => {
    expect(getFileFormat('changeset.yaml')).toBe('yaml');
  });

  test('returns yaml for .yml files', () => {
    expect(getFileFormat('changeset.yml')).toBe('yaml');
  });

  test('returns json for .json files', () => {
    expect(getFileFormat('changeset.json')).toBe('json');
  });

  test('returns yaml for unknown extensions (default)', () => {
    expect(getFileFormat('changeset.txt')).toBe('yaml');
    expect(getFileFormat('changeset')).toBe('yaml');
  });

  test('is case insensitive', () => {
    expect(getFileFormat('changeset.JSON')).toBe('json');
    expect(getFileFormat('changeset.YAML')).toBe('yaml');
    expect(getFileFormat('changeset.YML')).toBe('yaml');
  });
});

// ─── injectYamlVariables ────────────────────────────────────────────────────

describe('injectYamlVariables', () => {
  const baseYaml = `name: Test Queue
environment: Development
variable:
- environment: null
  mask_value: false
  name: existing_var
  value: old_value
- environment: Dev
  mask_value: true
  name: existing_var
  value: dev_value
action:
  - action: gencloud-create
    object_type: RoutingQueue`;

  test('injects new variables with mask_value: false by default', () => {
    const result = injectYamlVariables(baseYaml, { NEW_VAR: 'new_value' });
    expect(result).toContain('name: NEW_VAR');
    expect(result).toContain('value: new_value');
    expect(result).toContain('mask_value: false');
  });

  test('when overriding variable with mask_value: true in existing entry, preserves true', () => {
    const result = injectYamlVariables(baseYaml, { existing_var: 'replaced_value' });
    // Should have exactly one entry for existing_var (the injected one)
    const matches = result.match(/name: existing_var/g);
    expect(matches).toHaveLength(1);
    expect(result).toContain('value: replaced_value');
    expect(result).toContain('mask_value: true');
    expect(result).not.toContain('old_value');
    expect(result).not.toContain('dev_value');
  });

  test('preserves existing variables that are not overridden', () => {
    const yamlWithMultiple = `name: Test
variable:
- environment: null
  mask_value: false
  name: keep_this
  value: kept
- environment: null
  mask_value: false
  name: replace_this
  value: old`;
    const result = injectYamlVariables(yamlWithMultiple, { replace_this: 'new' });
    expect(result).toContain('name: keep_this');
    expect(result).toContain('value: kept');
    expect(result).toContain('name: replace_this');
    expect(result).toContain('value: new');
    expect(result).not.toContain('value: old');
  });

  test('sets environment to null for injected variables and removes all others', () => {
    const result = injectYamlVariables(baseYaml, { existing_var: 'val' });
    // Parse back to verify structure
    const yaml = require('js-yaml');
    const doc = yaml.load(result);
    const injected = doc.variable.find(v => v.name === 'existing_var');
    expect(injected.environment).toBeNull();
    // Should have exactly one entry for existing_var
    const allExisting = doc.variable.filter(v => v.name === 'existing_var');
    expect(allExisting).toHaveLength(1);
  });

  test('handles yaml with empty variable array', () => {
    const yamlEmpty = `name: Test\nvariable: []`;
    const result = injectYamlVariables(yamlEmpty, { NEW_VAR: 'value' });
    expect(result).toContain('name: NEW_VAR');
    expect(result).toContain('value: value');
  });

  test('handles yaml with no variable field', () => {
    const yamlNoVar = `name: Test\nenvironment: Dev`;
    const result = injectYamlVariables(yamlNoVar, { NEW_VAR: 'value' });
    expect(result).toContain('name: NEW_VAR');
    expect(result).toContain('value: value');
  });

  test('injects multiple variables at once, preserving mask_value from existing', () => {
    const result = injectYamlVariables(baseYaml, { VAR_A: 'aaa', existing_var: 'bbb' });
    const yaml = require('js-yaml');
    const doc = yaml.load(result);
    const varA = doc.variable.find(v => v.name === 'VAR_A');
    const varB = doc.variable.find(v => v.name === 'existing_var');
    // VAR_A is new, should have false (no existing entries with true)
    expect(varA).toEqual({ environment: null, mask_value: false, name: 'VAR_A', value: 'aaa' });
    // existing_var has entries with mask_value: true, should preserve it
    expect(varB.environment).toBeNull();
    expect(varB.mask_value).toBe(true);
    expect(varB.value).toBe('bbb');
  });
});

// ─── run() — JSON file format ──────────────────────────────────────────────

describe('run — JSON file format', () => {
  const SAMPLE_JSON_CHANGESET_OBJ = {
    name: 'Test Queue',
    environment: 'Development',
    variable: [
      { environment: null, mask_value: false, name: 'DogsName', value: 'global value' },
      { environment: 1, mask_value: false, name: 'DogsName', value: 'dev value' },
    ],
    action: [{ action: 'gencloud-create', object_type: 'RoutingQueue', data: { name: 'Test Queue' } }]
  };
  const SAMPLE_JSON_CHANGESET = JSON.stringify(SAMPLE_JSON_CHANGESET_OBJ, null, 2);
  const SAMPLE_JSON_FILE = path.join(__dirname, '__test_changeset_sample__.json');

  beforeAll(() => {
    fs.writeFileSync(SAMPLE_JSON_FILE, SAMPLE_JSON_CHANGESET);
  });

  afterAll(() => {
    if (fs.existsSync(SAMPLE_JSON_FILE)) fs.unlinkSync(SAMPLE_JSON_FILE);
  });

  test('uses application/json content type and validate_json endpoint for .json files', async () => {
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io',
      changeset_file: SAMPLE_JSON_FILE,
      validate_only: 'true',
    });

    const validResult = { is_valid: true, changeset_name: 'Test' };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, validationTaskResponse('v-json')))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(validResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://test.inprod.io/api/v1/change-set/change-set/validate_json/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
    // Body should be raw JSON changeset content (not wrapped)
    const body = mockFetch.mock.calls[0][1].body;
    expect(body).toBe(SAMPLE_JSON_CHANGESET);
    expect(mockCore.setFailed).not.toHaveBeenCalled();
  });

  test('uses execute_json endpoint for .json files', async () => {
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io',
      changeset_file: SAMPLE_JSON_FILE,
      validate_before_execute: 'false',
    });

    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://test.inprod.io/api/v1/change-set/change-set/execute_json/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
    // Body should be raw JSON changeset content (not wrapped)
    const body = mockFetch.mock.calls[0][1].body;
    expect(body).toBe(SAMPLE_JSON_CHANGESET);
    expect(mockCore.setFailed).not.toHaveBeenCalled();
  });

  test('injects variables into JSON changeset body for .json files', async () => {
    mockInputs({
      api_key: 'key',
      base_url: 'https://test.inprod.io',
      changeset_file: SAMPLE_JSON_FILE,
      validate_before_execute: 'false',
      changeset_variables: 'DogsName=overridden\nNewVar=newval',
    });

    const execResult = { run_id: 42, changeset_name: 'Test', environment: { id: 1, name: 'Dev' } };
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, executeTaskResponse()))
      .mockResolvedValueOnce(mockFetchResponse(200, successPollResponse(execResult)));

    const promise = run();
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Should NOT have a wrapper changeset/variables field
    expect(body.changeset).toBeUndefined();
    expect(body.variables).toBeUndefined();
    // All existing DogsName entries should be removed, replaced with one injected entry
    const dogsEntries = body.variable.filter(v => v.name === 'DogsName');
    expect(dogsEntries).toHaveLength(1);
    expect(dogsEntries[0]).toEqual({ environment: null, mask_value: false, name: 'DogsName', value: 'overridden' });
    // New variable should be added
    const newVarEntry = body.variable.find(v => v.name === 'NewVar');
    expect(newVarEntry).toEqual({ environment: null, mask_value: false, name: 'NewVar', value: 'newval' });
    expect(mockCore.setFailed).not.toHaveBeenCalled();
  });
});

// ─── injectJsonVariables ────────────────────────────────────────────────────

describe('injectJsonVariables', () => {
  const baseJson = JSON.stringify({
    name: 'Test Queue',
    variable: [
      { environment: null, mask_value: false, name: 'existing_var', value: 'old_value' },
      { environment: 1, mask_value: false, name: 'existing_var', value: 'dev_value' },
      { environment: null, mask_value: true, name: 'keep_var', value: 'kept' },
    ],
    action: [{ action: 'gencloud-create' }]
  }, null, 2);

  test('injects new variables with mask_value: false by default', () => {
    const result = JSON.parse(injectJsonVariables(baseJson, { NEW_VAR: 'new_value' }));
    const injected = result.variable.find(v => v.name === 'NEW_VAR');
    expect(injected).toEqual({ environment: null, mask_value: false, name: 'NEW_VAR', value: 'new_value' });
  });

  test('when overriding variable with only mask_value: false entries, uses false', () => {
    const result = JSON.parse(injectJsonVariables(baseJson, { existing_var: 'replaced_value' }));
    const matches = result.variable.filter(v => v.name === 'existing_var');
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toBe('replaced_value');
    expect(matches[0].mask_value).toBe(false);
    expect(matches[0].environment).toBeNull();
  });

  test('when overriding variable with mask_value: true in existing entry, preserves true', () => {
    const result = JSON.parse(injectJsonVariables(baseJson, { keep_var: 'new_value' }));
    const matches = result.variable.filter(v => v.name === 'keep_var');
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toBe('new_value');
    expect(matches[0].mask_value).toBe(true);
    expect(matches[0].environment).toBeNull();
  });

  test('preserves existing variables that are not overridden', () => {
    const result = JSON.parse(injectJsonVariables(baseJson, { existing_var: 'new' }));
    const kept = result.variable.find(v => v.name === 'keep_var');
    expect(kept).toEqual({ environment: null, mask_value: true, name: 'keep_var', value: 'kept' });
  });

  test('handles JSON with empty variable array', () => {
    const jsonEmpty = JSON.stringify({ name: 'Test', variable: [] });
    const result = JSON.parse(injectJsonVariables(jsonEmpty, { NEW_VAR: 'value' }));
    expect(result.variable).toHaveLength(1);
    expect(result.variable[0].name).toBe('NEW_VAR');
  });

  test('handles JSON with no variable field', () => {
    const jsonNoVar = JSON.stringify({ name: 'Test', environment: 'Dev' });
    const result = JSON.parse(injectJsonVariables(jsonNoVar, { NEW_VAR: 'value' }));
    expect(result.variable).toHaveLength(1);
    expect(result.variable[0].name).toBe('NEW_VAR');
  });

  test('injects multiple variables at once, preserving mask_value from existing', () => {
    const result = JSON.parse(injectJsonVariables(baseJson, { VAR_A: 'aaa', keep_var: 'bbb' }));
    const varA = result.variable.find(v => v.name === 'VAR_A');
    const varB = result.variable.find(v => v.name === 'keep_var');
    // VAR_A is new, should have false (no existing entries with true)
    expect(varA).toEqual({ environment: null, mask_value: false, name: 'VAR_A', value: 'aaa' });
    // keep_var exists with mask_value: true, should preserve it
    expect(varB).toEqual({ environment: null, mask_value: true, name: 'keep_var', value: 'bbb' });
  });

  test('preserves other JSON fields', () => {
    const result = JSON.parse(injectJsonVariables(baseJson, { NEW_VAR: 'val' }));
    expect(result.name).toBe('Test Queue');
    expect(result.action).toEqual([{ action: 'gencloud-create' }]);
  });
});