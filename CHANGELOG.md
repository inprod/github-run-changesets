# Changelog

All notable changes to the InProd Run Changesets GitHub Action will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-18

### Initial Release

The InProd Run Changesets GitHub Action is now available for production use! This action enables automated validation and deployment of Genesys Cloud configuration changes through InProd changesets directly in your CI/CD pipelines.

### Added

#### Core Features
- **Changeset Validation** — Validate InProd changesets before execution using InProd's advanced rules engine
- **Changeset Execution** — Deploy validated changesets to target Genesys Cloud environments
- **Multi-Environment Support** — Target environments by name or ID, enabling environment promotion workflows
- **Batch Processing** — Process multiple changesets with glob pattern support and customizable execution strategies
- **Flexible Execution Strategies** — Choose between `per_file` (fail-fast per file) or `validate_first` (validate all, then execute) approaches
- **Configurable Validation** — Enable/disable pre-execution validation or validation-only mode for pull request checks
- **Secure Authentication** — API keys are automatically masked in logs
- **Comprehensive Polling** — Monitor task completion with customizable timeout (default 10 minutes)
- **Detailed Reporting** — Per-file execution status with structured JSON output

#### Changeset Variables (NEW)
- **GitHub Secrets Integration** — Inject secrets from GitHub Secrets without storing in version control or changesets
- **KEY=VALUE Format** — Simple, intuitive input format without JSON complexity
- **Comment Support** — Skip lines and add comments with `#` prefix
- **Multi-Line Variables** — Pass multiple secrets in single input with newline separation
- **Value Support** — Handle values containing `=` signs (e.g., connection strings, permissions)
- **Automatic Masking** — Variable values automatically masked in GitHub Actions logs

#### Input Parameters
- `api_key` — InProd API key (optional, falls back to `INPROD_API_KEY` env var)
- `base_url` — InProd instance URL (optional, falls back to `INPROD_BASE_URL` env var)
- `changeset_file` — Path to changeset file(s) or glob pattern (required)
- `environment` — Target environment name or ID (optional, overrides changeset file setting)
- `validate_before_execute` — Validate before execution (default: `true`)
- `validate_only` — Only validate without executing (default: `false`)
- `polling_timeout_minutes` — Task completion timeout in minutes (default: `10`)
- `execution_strategy` — How to process multiple files: `per_file` or `validate_first` (default: `per_file`)
- `fail_fast` — Stop on first failure (default: `false`)
- `changeset_variables` — Secrets/variables in KEY=VALUE format (optional)

#### Output Parameters
- `status` — Aggregate status across all files (SUCCESS, FAILURE, REVOKED, TIMEOUT, SUBMITTED)
- `result` — JSON array of per-file results with detailed execution information

#### Documentation
- **README.md** — Comprehensive guide with prerequisites, quick start, input/output reference
- **CONTRIBUTING.md** — Contributor guidelines for development and testing
- **Examples** — Six detailed workflow examples covering common use cases:
  - Basic single-file deployment
  - Pull request validation
  - Multi-environment pipeline with approvals
  - Batch processing with ordered execution
  - Scheduled validation jobs
  - Environment-specific deployments
- **Integration Examples** — Slack, Microsoft Teams, and Jira integration patterns
- **Troubleshooting** — Common errors, debugging tips, and resolution steps

### Features

#### Smart Execution
- Sequential file processing with alphabetical ordering (use filename prefixes: `01_`, `02_`, etc.)
- Glob pattern support for flexible changeset file matching
- Environment-specific deployments with conditional logic
- Approval gates integration (GitHub Environments)
- Multi-region deployment patterns via matrix strategy

#### Security
- API key masking in all logs
- Changeset variable masking (values never exposed in logs)
- Support for GitHub Secrets and repository secrets
- Environment-scoped API key recommendations
- No secrets stored in version control

#### Monitoring & Observability
- Structured JSON output for programmatic processing
- Per-file status reporting with error details
- Debug logging support for troubleshooting
- Polling status updates
- Integration with GitHub Actions workflow context

#### Reliability
- Automatic retry on transient network errors
- Task polling with configurable timeout
- Comprehensive error messages with actionable solutions
- Validation error reporting with detailed output
- Continue-on-error support for multi-file deployments

### Tested & Validated

- ✅ 84 tests passing with comprehensive coverage
- ✅ Single and multi-file deployments
- ✅ All execution strategies (per_file, validate_first)
- ✅ Error handling and edge cases
- ✅ Changeset variables parsing (JSON format, special characters, comments)
- ✅ API integration with mock responses
- ✅ Polling and timeout scenarios

### Known Limitations

- **Sequential Processing Only** — Changesets must be processed sequentially; parallel execution not supported (by design, to prevent conflicts)
- **No Conditional Changesets** — Cannot skip changesets based on runtime conditions; use separate workflows for conditional deployments
- **Single API Key** — One API key per action invocation (use separate jobs for multi-key scenarios)

### Breaking Changes

None — this is the initial release.

### Dependencies

- **Node.js 18+** — GitHub Actions runtime requirement
- **@actions/core** — GitHub Actions toolkit for input/output handling
- **@actions/github** — GitHub API client (available in action runtime)
- **Modern fetch API** — For HTTP requests (available in Node 18+)

### Migration Notes

For users migrating from manual InProd deployments to this action:

1. **Secrets Management** — Move API keys to GitHub Secrets for automatic masking
2. **Changeset Variables** — Use the new `changeset_variables` input for deployment-time secret injection
3. **Validation Strategy** — Consider enabling `validate_only` for pull request checks before deployment
4. **Execution Order** — Prefix changeset filenames with numbers to control execution order

### Upgrade Path

This is version `1.0.0`. Future releases will maintain backward compatibility within the v1.x range.

**Recommended Usage:**
```yaml
uses: inprod/github-run-changesets@v1  # Latest v1.x release
```

For production workflows, use the major version tag (`@v1`) to automatically receive bug fixes and minor feature updates.

### Support

- **Issues & Bugs** — [GitHub Issues](https://github.com/inprod/github-run-changesets/issues)
- **Questions** — See [README.md FAQs](https://github.com/inprod/github-run-changesets/blob/main/README.md#faqs)
- **InProd Support** — [InProd Solutions](https://www.inprod.io)
- **Contributing** — See [CONTRIBUTING.md](https://github.com/inprod/github-run-changesets/blob/main/CONTRIBUTING.md)

### License

GNU General Public License v3 (GPLv3) — See [LICENSE](https://github.com/inprod/github-run-changesets/blob/main/LICENSE) for details.

---

**Special Thanks**

This initial release represents meticulous development and comprehensive testing to ensure reliability for production deployments. Every feature has been thoroughly tested and documented.

**What's Next**

Future releases will focus on:
- Performance optimizations for large batches
- Additional integration examples
- Enhanced debugging capabilities
- Community feedback implementation
