# Contributing to InProd Run Changesets

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the InProd Run Changesets GitHub Action.

## Code of Conduct

This project is committed to providing a welcoming and inclusive environment for all contributors. Please be respectful and constructive in all interactions.

## Ways to Contribute

### Reporting Bugs

If you find a bug, please open a GitHub issue with:

1. **Clear title** — Describe the problem concisely
2. **Reproduction steps** — How to reproduce the issue
3. **Expected behavior** — What should happen
4. **Actual behavior** — What actually happens
5. **Environment details**:
   - GitHub Actions runner OS (ubuntu-latest, windows-latest, macos-latest)
   - Action version being used
   - InProd API version (if applicable)
   - Node.js version
6. **Logs and error messages** — Include relevant output or screenshots

### Requesting Features

Feature requests are welcome! Please open a GitHub issue with:

1. **Clear title** — Summarize the feature request
2. **Use case** — Explain why this feature would be valuable
3. **Proposed solution** — How you envision the feature working
4. **Alternatives considered** — Other approaches you've thought about
5. **Examples** — Usage examples demonstrating the feature

### Improving Documentation

Documentation improvements are always appreciated:

- Fix typos and grammar errors
- Clarify confusing sections
- Add examples or use cases
- Improve code snippets
- Expand FAQ section

### Code Contributions

We welcome pull requests! Before starting work on a significant feature, please open an issue first to discuss the approach.

## Development Setup

### Prerequisites

- Node.js 18+ and npm 8+
- Git
- A code editor (VS Code recommended)

### Local Setup

1. **Fork the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/github-run-changesets.git
   cd github-run-changesets
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Verify setup**
   ```bash
   npm test
   ```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-parallel-execution` — New feature
- `fix/timeout-handling-bug` — Bug fix
- `docs/improve-readme` — Documentation
- `test/add-integration-tests` — Tests

```bash
git checkout -b feature/your-feature-name
```

### Commit Messages

Write clear, descriptive commit messages:

**Good:**
```
Fix timeout handling in poll task

- Add retry logic for transient network errors
- Increase default polling interval from 2s to 5s
- Update tests to cover edge cases

Fixes #123
```

**Avoid:**
```
fix stuff
```

### Code Style

This project follows standard JavaScript/Node.js conventions:

- Use 2-space indentation
- Use `const` and `let` (not `var`)
- Use camelCase for variables and functions
- Use UPPER_CASE for constants
- Use meaningful variable names

The project uses no linter, but please follow the existing code style in the repository.

### Testing

All code changes must include tests. This project uses Jest.

**Run tests:**
```bash
npm test
```

**Run tests with coverage:**
```bash
npm test -- --coverage
```

**Run specific test file:**
```bash
npm test -- src/index.test.js
```

**Test naming convention:**
```javascript
describe('function name', () => {
  test('should do something specific', () => {
    // Arrange
    const input = 'test';

    // Act
    const result = myFunction(input);

    // Assert
    expect(result).toBe('expected output');
  });
});
```

### Test Coverage Requirements

- Maintain or improve overall coverage (currently 94%+ statements)
- New features should have 100% coverage
- Document any intentional exclusions with comments

## Pull Request Process

### Before Submitting

1. **Ensure tests pass**
   ```bash
   npm test
   ```

2. **Check code style** — Follow the existing patterns in the codebase

3. **Update documentation** — Update README.md or other docs if behavior changes

4. **Test the action locally** (optional but recommended)
   ```bash
   # Create a test workflow
   mkdir -p .github/workflows
   cat > .github/workflows/test.yml << 'EOF'
   name: Test Action
   on: [push]
   jobs:
     test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - name: Test action
           uses: ./
           with:
             api_key: test-key
             base_url: https://test.inprod.io
             changeset_file: test.yaml
   EOF
   ```

### Submitting a PR

1. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a pull request** on GitHub
   - Provide a clear title and description
   - Reference related issues with `Fixes #123` or `Related to #456`
   - Include screenshots or logs if relevant
   - Ensure CI checks pass

3. **Respond to feedback** — Address review comments promptly

### PR Description Template

```markdown
## Description
Brief explanation of changes

## Related Issue
Fixes #123

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation improvement
- [ ] Test improvement
- [ ] Performance improvement

## Changes
- Specific change 1
- Specific change 2
- Specific change 3

## Testing
- How was this tested?
- Any new test cases added?

## Breaking Changes
- [ ] No breaking changes
- [x] Breaking changes (describe below)

Breaking changes:
- Description of breaking change

## Checklist
- [ ] Tests pass (`npm test`)
- [ ] Code follows project style
- [ ] Documentation updated
- [ ] No console errors or warnings
- [ ] Commit messages are clear
```

## Architecture Overview

### Key Files

- **src/index.js** — Main action logic
  - `buildUrl()` — Construct API URLs with optional environment parameter
  - `validateFile()` — Validate a changeset file
  - `executeFile()` — Execute a changeset file
  - `pollTask()` — Poll for task completion
  - `processSingleFile()` — Orchestrate validate/execute/poll workflow
  - `run()` — Main entry point, coordinates multi-file processing

- **src/index.test.js** — Jest test suite
  - Unit tests for utility functions
  - Integration tests for workflows
  - Mock setup for InProd API

- **action.yml** — Action metadata
  - Input definitions
  - Output definitions
  - GitHub Actions configuration

### Key Concepts

**Files and Glob Patterns:**
- Single file: `changeset_file: changesets/deploy.yaml`
- Glob pattern: `changeset_file: changesets/*.yaml`
- Files matched by glob are sorted alphabetically and processed sequentially

**Execution Strategies:**
- `per_file` — Validate → Execute → Poll each file before moving to next (default)
- `validate_first` — Validate all files → Execute all files sequentially

**Task Polling:**
- Action submits a request and gets a `task_id`
- Polls the task status every 5 seconds
- Continues until task completes (SUCCESS/FAILURE/REVOKED) or timeout

## Testing Guidelines

### Unit Tests

Test individual functions in isolation:

```javascript
describe('buildUrl', () => {
  test('appends environment parameter to URL', () => {
    const url = buildUrl('https://api.inprod.io', '/endpoint', 'Production');
    expect(url).toContain('environment=Production');
  });
});
```

### Integration Tests

Test workflows involving multiple components:

```javascript
describe('run — validate before execute', () => {
  test('validates then executes on success', async () => {
    mockInputs({ validate_before_execute: 'true' });
    mockFetch
      .mockResolvedValueOnce(validationResponse)
      .mockResolvedValueOnce(pollResponse);

    await run();

    expect(mockCore.setOutput).toHaveBeenCalledWith('status', 'SUCCESS');
  });
});
```

### Mock Patterns

Use the existing mock patterns in the test file:

```javascript
// Mock GitHub Actions core
mockCore.getInput(name, options) // input values
mockCore.setOutput(name, value)  // outputs
mockCore.setFailed(message)      // set failure status
mockCore.info(message)           // logging

// Mock fetch
mockFetch.mockResolvedValueOnce(mockFetchResponse(status, data))
mockFetch.mockRejectedValueOnce(error)

// Mock timer advancement
await jest.advanceTimersByTimeAsync(5000)
```

## Common Development Tasks

### Adding a New Input Parameter

1. **Update action.yml**
   ```yaml
   - name: my_param
     description: 'Description of the parameter'
     required: false
     default: 'default_value'
   ```

2. **Update src/index.js**
   ```javascript
   const myParam = core.getInput('my_param');
   ```

3. **Add tests in src/index.test.js**
   ```javascript
   test('respects my_param input', async () => {
     mockInputs({ my_param: 'custom_value' });
     // ... test logic
   });
   ```

### Adding a New Output

1. **Update action.yml**
   ```yaml
   outputs:
     my_output:
       description: 'Description of output'
       value: ${{ steps.action.outputs.my_output }}
   ```

2. **Update src/index.js**
   ```javascript
   core.setOutput('my_output', value);
   ```

3. **Add tests**
   ```javascript
   expect(mockCore.setOutput).toHaveBeenCalledWith('my_output', expectedValue);
   ```

### Adding a New Feature

1. Create a branch: `git checkout -b feature/my-feature`
2. Implement feature in src/index.js
3. Add comprehensive tests in src/index.test.js
4. Update README.md with usage examples
5. Ensure all tests pass: `npm test`
6. Commit with clear message
7. Open PR with description and testing details

## Documentation

### README.md Updates

When adding features or changing behavior:

1. Update relevant input/output section
2. Add usage example if applicable
3. Update FAQs if appropriate
4. Ensure all examples are correct

### Code Comments

Add comments for complex logic:

```javascript
// Poor: No explanation
const timeout = polling_timeout_minutes * 60;

// Good: Context and reasoning
// Convert polling timeout from minutes to seconds for API consistency
const pollingTimeoutSeconds = pollingTimeoutMinutes * 60;
```

## Performance Considerations

- Minimize API calls (batch when possible)
- Consider polling interval impact on GitHub Actions billing
- Cache file reads when processing multiple files
- Document any potential performance impacts

## Security Considerations

- Never log sensitive values (API keys, tokens)
- Validate all user inputs
- Sanitize error messages before logging
- Use `core.setSecret()` to mask sensitive values

## Release Process

(Information for maintainers)

1. Update CHANGELOG.md
2. Update version in package.json following semver
3. Commit with message: `Release v1.x.x`
4. Create git tag: `git tag v1.x.x`
5. Push changes and tags: `git push origin main --tags`
6. GitHub Actions will automatically build and release

## Getting Help

- **Questions about the action?** Open a GitHub Discussion
- **Found a bug?** Open a GitHub Issue
- **Need help with InProd?** Check [InProd documentation](https://www.inprod.io)
- **Genesys Cloud questions?** See [Genesys Cloud Developer Center](https://developer.genesys.cloud)

## License

By contributing to this project, you agree that your contributions will be licensed under the GNU General Public License v3. See [LICENSE](LICENSE) for details.

## Recognition

Contributors will be recognized in:
- The project README
- Release notes when applicable
- GitHub's contributor graph

Thank you for contributing to make InProd Run Changesets better!
