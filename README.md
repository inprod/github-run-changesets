# InProd Run Changesets GitHub Action

![Tests](https://github.com/inprod/github-run-changesets/actions/workflows/tests.yml/badge.svg)
![License](https://img.shields.io/badge/license-GPLv3-blue)
![Node.js](https://img.shields.io/badge/node.js-18%2B-green)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![GitHub Action](https://img.shields.io/badge/github-action-blue)
![Status](https://img.shields.io/badge/status-stable-brightgreen)

A GitHub Action for managing Genesys Cloud configuration as code through InProd changesets. This action automates the validation and deployment of Genesys Cloud configuration changes via the InProd API, enabling secure, auditable, and repeatable deployments across multiple environments.

## Overview

InProd is a Configuration Management and DevOps platform purpose-built for Genesys Cloud. It packages configuration changes into reusable **changesets** that can be validated before execution and deployed consistently across environments. This GitHub Action brings InProd's deployment capabilities directly into your CI/CD pipelines, enabling:

- **Infrastructure as Code** — Store Genesys Cloud configurations in version control
- **Automated Deployments** — Execute changesets automatically on code commits or pull requests
- **Validation Gates** — Validate changes against target environments before deployment
- **Audit Trail** — Track all configuration changes through your git history and InProd's execution logs
- **Risk Reduction** — Eliminate manual configuration errors that cause service interruptions

## Key Features

- ✅ **Automated validation** using InProd's advanced rules engine (enabled by default)
- ✅ **Validate-only mode** for pre-deployment checks and pull request validation
- ✅ **Multi-environment support** via environment targeting (name or ID)
- ✅ **Flexible file formats** — YAML and JSON changeset support
- ✅ **Batch processing** — Execute multiple changesets with glob patterns
- ✅ **Configurable polling** — Monitor execution progress with customizable timeout
- ✅ **Secure authentication** — API keys are masked in logs
- ✅ **Detailed reporting** — Comprehensive execution status and results

## Prerequisites

Before using this action, ensure you have:

1. **InProd Instance** — Access to an InProd installation with API enabled
2. **InProd API Key** — Generated from your InProd instance with required permissions:
   - `view_changeset` — View changeset details and validation results
   - `run_changeset` — Execute changesets against target environments
3. **GitHub Secrets** — API key stored as a repository or organization secret
4. **Changeset Files** — One or more InProd changeset files (YAML or JSON) in your repository

## Quick Start

### 1. Store Your API Key

Add your InProd API key to GitHub Secrets:
- Navigate to your repository → Settings → Secrets and variables → Actions
- Click "New repository secret"
- Name: `INPROD_API_KEY`
- Value: Your InProd API key

### 2. Create a Basic Workflow

Create `.github/workflows/deploy-genesys.yml`:

```yaml
name: Deploy to Genesys Cloud

on:
  push:
    branches: [main]
    paths: ['changesets/**']

env:
  INPROD_API_KEY: ${{ secrets.INPROD_API_KEY }}
  INPROD_BASE_URL: https://your-company.inprod.io

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy changeset
        uses: inprod/github-run-changesets@v1
        with:
          changeset_file: changesets/deploy-queues.yaml
          environment: Production
```

### 3. Commit and Push

When you push changes to InProd changeset file `changesets/deploy-queues.yaml`, the action automatically validates and deploys your configuration to Genesys Cloud.

## Input Reference

### `api_key` (optional)

**Description:** InProd API key for authentication

**Default:** Value from `INPROD_API_KEY` environment variable

**Usage:**
```yaml
# Option 1: Direct input (use for single-step workflows)
api_key: ${{ secrets.INPROD_API_KEY }}

# Option 2: Environment variable (recommended for multi-step workflows)
env:
  INPROD_API_KEY: ${{ secrets.INPROD_API_KEY }}
```

### `base_url` (optional)

**Description:** Base URL of your InProd instance (must include protocol)

**Default:** Value from `INPROD_BASE_URL` environment variable

**Example:** `https://your-company.inprod.io`

**Usage:**
```yaml
# Option 1: Direct input
base_url: https://your-company.inprod.io

# Option 2: Environment variable (recommended)
env:
  INPROD_BASE_URL: https://your-company.inprod.io
```

### `changeset_file` (required)

**Description:** Path to changeset file(s). Supports single files or glob patterns.

**File Formats:** YAML (`.yaml`, `.yml`) or JSON (`.json`)

**Examples:**
```yaml
# Single file
changeset_file: changesets/deploy-queue.yaml

# Glob pattern (files executed in alphabetical order)
changeset_file: changesets/*.yaml

# Multiple patterns
changeset_file: changesets/core/*.yaml
```

**Note:** When using glob patterns, prefix filenames with numbers to control execution order (e.g., `01_queues.yaml`, `02_flows.yaml`).

### `environment` (optional)

**Description:** Target Genesys Cloud environment name or ID

**Behavior:** Overrides the `environment` field in the changeset file, enabling environment promotion

**Case Sensitivity:** Environment names are case-insensitive

**Examples:**
```yaml
# By name
environment: Production

# By ID
environment: 42

# Environment-specific deployments
environment: ${{ github.ref == 'refs/heads/main' && 'Production' || 'Development' }}
```

### `validate_before_execute` (optional)

**Description:** Validate changeset before execution

**Default:** `true`

**Behavior:**
- `true` — Validates before execution; fails if validation errors occur
- `false` — Skips validation and executes directly (not recommended)

**Usage:**
```yaml
# Disable pre-execution validation (not recommended)
validate_before_execute: false
```

### `validate_only` (optional)

**Description:** Only validate the changeset without executing

**Default:** `false`

**Use Cases:**
- Pull request validation checks
- Pre-deployment verification
- Scheduled validation jobs

**Usage:**
```yaml
validate_only: true
```

### `polling_timeout_minutes` (optional)

**Description:** Maximum time to wait for task completion (validation and execution). Higher values maybe required for large changeset or changesets that call external services such as Cyara.

**Default:** `10` minutes

**Usage:**
```yaml
# Large changesets may need more time
polling_timeout_minutes: 20
```

### `execution_strategy` (optional)

**Description:** How to process multiple matched files

**Default:** `per_file`

**Options:**
- `per_file` — Validate and execute each file before moving to the next (fail-fast per file)
- `validate_first` — Validate all files first, then execute sequentially

**Applies To:** Only relevant when `changeset_file` matches multiple files

**Usage:**
```yaml
# Validate all files before executing any
execution_strategy: validate_first
```

### `fail_fast` (optional)

**Description:** Stop processing on first failure

**Default:** `false`

**Behavior:**
- `true` — Stop immediately when a file fails
- `false` — Continue processing all files; report all failures at the end

**Usage:**
```yaml
# Stop on first failure
fail_fast: true
```

### `changeset_variables` (optional)

**Description:** Changeset variables in KEY=VALUE format to inject into validation and execution requests

**Default:** None

**Purpose:** Allows passing secrets and other sensitive values from GitHub Secrets without storing them in version control or changeset files. This is an alternative to keeping the secret values within InProd variables. Ensure the InProd variable is configed as 'Masked' within InProd to prevent the content leaking in run reports and automated change control documentation.

**Format:** KEY=VALUE pairs (one per line). Keys and values are trimmed of whitespace. Comments starting with `#` are ignored.

**Examples:**
```yaml
# Single variable
changeset_variables: DATABASE_PASSWORD=${{ secrets.DB_PASSWORD }}

# Multiple variables
changeset_variables: |
  API_KEY=${{ secrets.API_KEY }}
  DB_USER=${{ secrets.DB_USER }}
  DB_PASSWORD=${{ secrets.DB_PASSWORD }}
```

**Usage:**
```yaml
- name: Deploy with secrets
  uses: inprod/github-run-changesets@v1
  with:
    changeset_file: changesets/deploy.yaml
    environment: Production
    changeset_variables: |
      DATABASE_PASSWORD=${{ secrets.DB_PASSWORD }}
      API_TOKEN=${{ secrets.API_TOKEN }}
```

**How It Works:**
1. User provides variables as KEY=VALUE pairs via `changeset_variables` input
2. Variables are passed to InProd API during both validation and execution
3. InProd substitutes variable placeholders in the changeset with provided values
4. Changeset file remains clean and secret-free in version control

## Output Reference

### `status`

**Type:** String

**Description:** Aggregate status across all processed files

**Values:**
- `SUCCESS` — All operations completed successfully
- `FAILURE` — One or more operations failed
- `REVOKED` — Task was cancelled
- `TIMEOUT` — Task exceeded polling timeout

**Usage:**
```yaml
- name: Check deployment status
  run: |
    if [ "${{ steps.deploy.outputs.status }}" != "SUCCESS" ]; then
      echo "Deployment failed"
      exit 1
    fi
```

### `result`

**Type:** JSON Array

**Description:** Detailed per-file results

**Structure:**
```json
[
  {
    "file": "deploy-queue.yaml",
    "status": "SUCCESS",
    "result": {
      "run_id": 42,
      "changeset_name": "Deploy Queue Configuration",
      "environment": {
        "id": 3,
        "name": "Production"
      }
    },
    "error": null
  }
]
```

**Usage:**
```yaml
- name: Parse results
  run: |
    echo '${{ steps.deploy.outputs.result }}' | jq '.'
```

## Usage Examples

### Example 1: Basic Single-File Deployment

Deploy a single changeset when changes are pushed to main:

```yaml
name: Deploy Queue Configuration

on:
  push:
    branches: [main]
    paths: ['changesets/queues.yaml']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Production
        uses: inprod/github-run-changesets@v1
        with:
          api_key: ${{ secrets.INPROD_API_KEY }}
          base_url: https://your-company.inprod.io
          changeset_file: changesets/queues.yaml
          environment: Production
```

### Example 2: Pull Request Validation

Validate changesets in pull requests without executing:

```yaml
name: Validate Changesets

on:
  pull_request:
    paths: ['changesets/**']

env:
  INPROD_API_KEY: ${{ secrets.INPROD_API_KEY }}
  INPROD_BASE_URL: https://your-company.inprod.io

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate against Production
        uses: inprod/github-run-changesets@v1
        with:
          changeset_file: changesets/*.yaml
          environment: Production
          validate_only: true

      - name: Comment on PR
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const status = '${{ steps.validate.outputs.status }}';
            const message = status === 'SUCCESS' 
              ? '✅ All changesets validated successfully'
              : '❌ Validation failed - check action logs';
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: message
            });
```

### Example 3: Multi-Environment Pipeline with Approvals

Deploy sequentially through Dev → UAT → Production with validation and approval gates:

```yaml
name: Multi-Environment Deployment

on:
  push:
    branches: [main]
    paths: ['changesets/**']

env:
  INPROD_API_KEY: ${{ secrets.INPROD_API_KEY }}
  INPROD_BASE_URL: https://your-company.inprod.io

jobs:
  # Stage 1: Validate against all environments
  validate-all:
    name: Validate All Environments
    runs-on: ubuntu-latest
    strategy:
      matrix:
        environment: [Development, UAT, Production]
    steps:
      - uses: actions/checkout@v4
      
      - name: Validate ${{ matrix.environment }}
        uses: inprod/github-run-changesets@v1
        with:
          changeset_file: changesets/*.yaml
          environment: ${{ matrix.environment }}
          validate_only: true

  # Stage 2: Deploy to Development
  deploy-dev:
    name: Deploy to Development
    needs: validate-all
    runs-on: ubuntu-latest
    environment: Development
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy changesets
        uses: inprod/github-run-changesets@v1
        with:
          changeset_file: changesets/*.yaml
          environment: Development
          execution_strategy: validate_first

  # Stage 3: Deploy to UAT (requires approval)
  deploy-uat:
    name: Deploy to UAT
    needs: deploy-dev
    runs-on: ubuntu-latest
    environment: UAT  # Configure approval in GitHub Settings
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy changesets
        uses: inprod/github-run-changesets@v1
        with:
          changeset_file: changesets/*.yaml
          environment: UAT
          execution_strategy: validate_first

  # Stage 4: Deploy to Production (requires approval)
  deploy-prod:
    name: Deploy to Production
    needs: deploy-uat
    runs-on: ubuntu-latest
    environment: Production  # Configure approval in GitHub Settings
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy changesets
        uses: inprod/github-run-changesets@v1
        with:
          changeset_file: changesets/*.yaml
          environment: Production
          execution_strategy: validate_first
          polling_timeout_minutes: 20
```

**Key Features:**
- **Validation** across all environments before deployment (optional)
- **Validate-first strategy** ensures all changesets are valid before execution (optional)
- **Sequential deployment** changes deployed in user defined order
- **GitHub environment protection** for UAT and Production approvals

### Example 4: Batch Processing with Ordered Execution

Deploy multiple changesets in a specific order using filename prefixes:

```yaml
name: Deploy All Configurations

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - Development
          - UAT
          - Production

env:
  INPROD_API_KEY: ${{ secrets.INPROD_API_KEY }}
  INPROD_BASE_URL: https://your-company.inprod.io

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy ordered changesets
        uses: inprod/github-run-changesets@v1
        with:
          changeset_file: changesets/*.yaml
          environment: ${{ inputs.environment }}
          execution_strategy: validate_first
          fail_fast: true
```

**Changeset File Structure:**
```
changesets/
├── 01_queues.yaml          # Executed first
├── 02_skills.yaml          # Executed second
├── 03_sales_outbound.yaml  # Executed third
└── 04_sales_ivr.yaml       # Executed last
```

### Example 5: Scheduled Validation

Run validation checks on a schedule to detect configuration drift:

```yaml
name: Scheduled Validation

on:
  schedule:
    # Run every day at 2 AM UTC
    - cron: '0 2 * * *'

env:
  INPROD_API_KEY: ${{ secrets.INPROD_API_KEY }}
  INPROD_BASE_URL: https://your-company.inprod.io

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Validate Production configurations
        id: validate
        uses: inprod/github-run-changesets@v1
        with:
          changeset_file: changesets/*.yaml
          environment: Production
          validate_only: true
        continue-on-error: true

      - name: Notify on validation failure
        if: steps.validate.outputs.status != 'SUCCESS'
        uses: slackapi/slack-github-action@v1
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK }}
          payload: |
            {
              "text": "⚠️ Production validation failed - configuration drift detected",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*Production Validation Failed*\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Details>"
                  }
                }
              ]
            }
```

### Example 6: Environment-Specific Deployments

Deploy different changesets based on the branch:

```yaml
name: Branch-Based Deployment

on:
  push:
    branches:
      - develop
      - staging
      - main

env:
  INPROD_API_KEY: ${{ secrets.INPROD_API_KEY }}
  INPROD_BASE_URL: https://your-company.inprod.io

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Determine environment
        id: env
        run: |
          case "${{ github.ref }}" in
            refs/heads/develop)
              echo "environment=Development" >> $GITHUB_OUTPUT
              ;;
            refs/heads/staging)
              echo "environment=UAT" >> $GITHUB_OUTPUT
              ;;
            refs/heads/main)
              echo "environment=Production" >> $GITHUB_OUTPUT
              ;;
          esac

      - name: Deploy to ${{ steps.env.outputs.environment }}
        uses: inprod/github-run-changesets@v1
        with:
          changeset_file: changesets/*.yaml
          environment: ${{ steps.env.outputs.environment }}
```

## Error Handling and Troubleshooting

### Common Errors and Solutions

| Error Message | Cause | Solution |
|--------------|-------|----------|
| `api_key is required` | Missing or empty API key | Set `INPROD_API_KEY` secret or provide `api_key` input |
| `Invalid base_url format` | Missing protocol or malformed URL | Use format: `https://your-company.inprod.io` |
| `Invalid changeset_variables format` | Invalid KEY=VALUE format in `changeset_variables` | Each line must be KEY=VALUE with no equals sign in the key |
| `Variable {{variable_name}} not resolved` | Variable not passed or name mismatch | Check variable name matches exactly (case-sensitive) |

| `changeset_file is required` | Missing changeset file path | Provide the `changeset_file` input |
| `Changeset file not found: <path>` | File doesn't exist in repository | Verify path and ensure `actions/checkout@v4` runs first |
| `API request failed with status 401` | Invalid or expired API key | Check API key in GitHub secrets matches InProd |
| `API request failed with status 403` | Insufficient API permissions | Ensure API key has `view_changeset` and `run_changeset` permissions for target environment |
| `Changeset validation failed` | Changeset contains errors | Review validation output; fix changeset configuration |
| `Task failed: <error>` | Execution error in InProd | Check InProd UI for detailed error messages and logs |
| `Task did not complete within X seconds` | Polling timeout exceeded | Increase `polling_timeout_minutes` or investigate long-running tasks in InProd |

### Debugging

Enable debug logging for detailed troubleshooting:

**Method 1: Repository Secret**
1. Go to Settings → Secrets and variables → Actions
2. Create secret: `ACTIONS_STEP_DEBUG` = `true`

**Method 2: Workflow Re-run**
- Click "Re-run jobs" → "Enable debug logging"

**Debug Output Includes:**
- Detailed API request/response data
- Polling status updates
- File matching results
- Validation progress

### Validation Failures

When validation fails, InProd provides detailed error messages. Common validation errors:

- **Missing Dependencies:** Referenced objects (queues, flows, skills) don't exist in target environment
- **Configuration Conflicts:** Settings incompatible with target environment configuration
- **Permission Issues:** API key lacks permissions for specific configuration objects
- **Data Validation:** Invalid values or formats in changeset

**Resolution Steps:**
1. Review the error output from the action
2. Check the InProd UI for detailed validation report
3. Verify referenced objects exist in target environment
4. Update changeset and re-run

### Best Practices for Error Handling

```yaml
- name: Deploy with error handling
  id: deploy
  uses: inprod/github-run-changesets@v1
  with:
    changeset_file: changesets/*.yaml
    environment: Production
    fail_fast: true
  continue-on-error: true

- name: Handle failure
  if: steps.deploy.outputs.status != 'SUCCESS'
  run: |
    echo "Deployment failed with status: ${{ steps.deploy.outputs.status }}"
    echo "Results: ${{ steps.deploy.outputs.result }}"
    # Add custom error handling (notifications, rollback, etc.)
    exit 1
```


## API Permissions

### Required Permissions

The InProd API key must have these permissions:

| Permission | Scope | Purpose |
|-----------|-------|---------|
| `view_changeset` | Target environment(s) or global | Read changeset details and validation results |
| `run_changeset` | Target environment(s) or global | Execute changesets |

### Permission Scoping

For enhanced security, scope API keys to specific environments:

- **Development Key:** `view_changeset`, `run_changeset` on Development environment only
- **Production Key:** `view_changeset`, `run_changeset` on Production environment only

This prevents accidental cross-environment deployments.

## Versioning and Updates

This action follows [semantic versioning](https://semver.org/):

- `@v1` — Latest stable v1.x.x release (recommended)
- `@v1.2.3` — Specific version (maximum stability)
- `@main` — Latest development version (use with caution)

### Recommended Usage

```yaml
# Production workflows - use major version tag
uses: inprod/github-run-changesets@v1

# Testing new features - use specific version
uses: inprod/github-run-changesets@v1.2.3

# Development only - use main branch
uses: inprod/github-run-changesets@main
```

### Staying Updated

- Watch the [repository](https://github.com/inprod/github-run-changesets) for releases
- Review the [CHANGELOG](https://github.com/inprod/github-run-changesets/blob/main/CHANGELOG.md) before upgrading
- Test new versions in non-production environments first


## Advanced Patterns

### Dynamic Environment Selection

```yaml
- name: Select environment based on PR labels
  id: env
  run: |
    if [[ "${{ contains(github.event.pull_request.labels.*.name, 'deploy:prod') }}" == "true" ]]; then
      echo "environment=Production" >> $GITHUB_OUTPUT
    else
      echo "environment=UAT" >> $GITHUB_OUTPUT
    fi

- name: Deploy to selected environment
  uses: inprod/github-run-changesets@v1
  with:
    changeset_file: changesets/*.yaml
    environment: ${{ steps.env.outputs.environment }}
```

### Matrix Strategy for Multi-Region Deployments

```yaml
jobs:
  deploy:
    strategy:
      matrix:
        region: [us-east-1, eu-west-1, ap-southeast-2]
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to ${{ matrix.region }}
        uses: inprod/github-run-changesets@v1
        with:
          api_key: ${{ secrets[format('INPROD_API_KEY_{0}', matrix.region)] }}
          base_url: ${{ secrets[format('INPROD_URL_{0}', matrix.region)] }}
          changeset_file: changesets/*.yaml
          environment: Production
```

### Rollback on Failure

InProd changesets support automated rollback on failure, but you can also have dedicated changsets to perform additional rollback functions.

```yaml
- name: Deploy new configuration
  id: deploy
  uses: inprod/github-run-changesets@v1
  with:
    changeset_file: changesets/new-config.yaml
    environment: Production
  continue-on-error: true

- name: Rollback on failure
  if: steps.deploy.outputs.status != 'SUCCESS'
  uses: inprod/github-run-changesets@v1
  with:
    changeset_file: changesets/rollback-config.yaml
    environment: Production
```

## Integration Examples

### Slack Notifications

```yaml
- name: Deploy changesets
  id: deploy
  uses: inprod/github-run-changesets@v1
  with:
    changeset_file: changesets/*.yaml
    environment: Production

- name: Notify Slack
  uses: slackapi/slack-github-action@v1
  with:
    webhook-url: ${{ secrets.SLACK_WEBHOOK }}
    payload: |
      {
        "text": "${{ steps.deploy.outputs.status == 'SUCCESS' && '✅' || '❌' }} Deployment ${{ steps.deploy.outputs.status }}",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*Genesys Cloud Deployment*\nStatus: `${{ steps.deploy.outputs.status }}`\nEnvironment: Production\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Details>"
            }
          }
        ]
      }
```

### Microsoft Teams Notifications

```yaml
- name: Notify Teams
  if: always()
  uses: aliencube/microsoft-teams-actions@v0.8.0
  with:
    webhook_uri: ${{ secrets.TEAMS_WEBHOOK }}
    title: Genesys Cloud Deployment
    summary: ${{ steps.deploy.outputs.status }}
    text: |
      **Environment:** Production
      **Status:** ${{ steps.deploy.outputs.status }}
      **Triggered by:** ${{ github.actor }}
      [View Workflow Run](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})
```

### Jira Integration

```yaml
- name: Update Jira ticket
  if: steps.deploy.outputs.status == 'SUCCESS'
  uses: atlassian/gajira-transition@v3
  with:
    issue: ${{ github.event.head_commit.message | grep -oP 'PROJ-\d+' }}
    transition: "Deploy to Production"
  env:
    JIRA_BASE_URL: ${{ secrets.JIRA_BASE_URL }}
    JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
    JIRA_USER_EMAIL: ${{ secrets.JIRA_USER_EMAIL }}
```

## FAQs

**Q: Can I run multiple changesets in parallel?**
A: No. InProd changesets execute sequentially, never in parallel. This prevents concurrent modifications to the same Genesys Cloud organization which could cause conflicts.

**Q: What happens if validation fails?**
A: When `validate_before_execute` is `true` (default), the action fails without executing if validation errors occur. The validation output details specific issues to fix.

**Q: Can I use this action with Genesys Cloud CX?**
A: Yes. InProd is designed for Genesys Cloud (formerly PureCloud), and this action manages Genesys Cloud configuration through InProd's changesets.

**Q: How do I handle secrets in changeset files?**
A: Use the `changeset_variables` input to inject secrets from GitHub Secrets without storing them in version control. Define variable placeholders in your changeset (e.g., `[?? database_password ??]`), then pass the values via the action input:
```yaml
changeset_variables: |
  database_password=${{ secrets.DB_PASSWORD }}
  api_token=${{ secrets.API_TOKEN }}
```
This approach keeps secrets secure and out of version control. See "Managing Secrets with Changeset Variables" section for detailed examples.

**Q: What's the difference between global variables and changeset variables?**
A: **Global variables** are defined once in InProd UI and reused across all changesets. **Changeset variables** are scoped to be visable only at the changeset level. Both support different value per environment and the ability to mask values. You can use both approaches in the same changeset.

**Q: Can I pass environment variables to my changeset?**
A: Yes, use the `changeset_variables` input with GitHub Actions context expressions:
```yaml
changeset_variables: |
  {
    "environment_name": "${{ github.ref_name }}",
    "deployment_id": "${{ github.run_id }}",
    "triggered_by": "${{ github.actor }}"
  }
```

**Q: Can I revert a deployed changeset?**
A: Changes can easily be reverted within the InProd UI as every objects history if recorded.

**Q: How long are changeset execution logs retained?**
A: Log retention is controlled by InProd, not this action. Check your InProd instance configuration for retention policies.

**Q: Can I deploy to multiple Genesys Cloud orgs?**
A: Yes. Use separate InProd environments for each Genesys Cloud org, you can use the same API key if desired.

## Support and Resources

### Getting Help
- [Open an Issue](https://github.com/inprod/github-run-changesets/issues) for bugs or feature requests
- Contact [InProd Support](https://www.inprod.io) for platform-specific questions
- Review the [Genesys Cloud Developer Center](https://developer.genesys.cloud) for Genesys Cloud configuration guidance

### Contributing
Contributions are welcome! Please see [CONTRIBUTING.md](https://github.com/inprod/github-run-changesets/blob/main/CONTRIBUTING.md) for guidelines.

## License

GNU General Public License v3 — See [LICENSE](https://github.com/inprod/github-run-changesets/blob/main/LICENSE) file for details.

---

**Trademarks:** Genesys®, Genesys Cloud™, and the Genesys Cloud logo are trademarks of Genesys. This action is maintained by InProd Solutions and is not an official Genesys product.

