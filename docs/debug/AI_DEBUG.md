# AI Debug Log

> **Last Updated**: 2025-01-12
> **Audience**: Developers

This file contains debug logs for AI extraction calls when `AI_DEBUG=true`.

## Related Documents

- [Document Vault / Extraction](../features/document-processing/EXTRACTION.md) - AI extraction details
- [Environment Variables](../reference/ENVIRONMENT_VARIABLES.md) - Configuration options

## How to Enable Debug Logging

Set the following environment variable in your `.env` file:

```bash
AI_DEBUG=true
```

When enabled, the system automatically appends detailed AI call logs to **this file** (`docs/AI_DEBUG.md`).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_DEBUG` | `false` | Enable AI debug logging to this file |
| `AI_DEBUG_LOG_PROMPTS` | `true` | Include full prompts in logs |
| `AI_DEBUG_LOG_RESPONSES` | `true` | Include full AI responses in logs |
| `AI_DEBUG_LOG_IMAGES` | `false` | Include image metadata in logs |

## Log Format

Each AI call logs:
1. **Request Details** - Model, provider, operation, tenant, temperature, COA context
2. **Prompt** - Full extraction prompt (collapsible)
3. **Response** - Status, latency, token counts, estimated cost, raw response (collapsible)
4. **Extraction Results** - Document fields and line item account codes

## Troubleshooting Account Code Assignment

### Common Issues

1. **No account code assigned** (`❌ NOT ASSIGNED`)
   - Check if COA context was included (look for `COA Context: Yes`)
   - Verify tenant has chart of accounts configured in 4xxx-8xxx range
   - Review the prompt to ensure accounts are listed

2. **Wrong account code assigned**
   - Check the AI response for the `accountCode` field
   - Review the description and compare to available accounts
   - Consider adding more specific accounts to COA

3. **Low confidence scores** (< 0.7)
   - AI is uncertain about the mapping
   - Review the line item description for clarity
   - Consider manual assignment for edge cases

### Expected Account Code Ranges

- **4xxx**: Revenue accounts (sales, service income)
- **5xxx**: Cost of goods sold (direct costs, purchases)
- **6xxx-7xxx**: Operating expenses (admin, marketing, utilities)
- **8xxx**: Tax expenses (income tax, deferred tax)

## Clearing Logs

To clear this log file, you can:
1. Delete everything below the `---` line manually
2. Or use the `clearDebugLog()` function programmatically

---
## AI Error - 2026-09-03T04:23:55.288Z

| Field | Value |
|-------|-------|
| Operation | manual_connector_pdf_test |
| Model | perplexity/sonar-pro-search |
| Provider | openrouter |
| Connector Source | system |
| Connector ID | df13eefe-56bb-4f0b-902f-cdf9cb865ab8 |
| Connector Name | Openrouter |

### Error Details
- **Type**: AuthenticationError
- **Message**: 401 Missing Authentication header
- **Retryable**: false

<details>
<summary>Stack Trace</summary>

```
Error: 401 Missing Authentication header
    at Function.generate (C:\Users\Scofieldkoh\Documents\oakcloud\node_modules\openai\src\error.ts:76:14)
    at OpenAI.makeStatusError (C:\Users\Scofieldkoh\Documents\oakcloud\node_modules\openai\src\core.ts:462:21)
    at OpenAI.makeRequest (C:\Users\Scofieldkoh\Documents\oakcloud\node_modules\openai\src\core.ts:526:24)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async callOpenRouter (C:\Users\Scofieldkoh\Documents\oakcloud\src\lib\ai\providers\openrouter.ts:177:16)
    at async callAIWithConnector (C:\Users\Scofieldkoh\Documents\oakcloud\src\lib\ai\index.ts:531:22)
    at async [eval]:17:18
```
</details>

---

## AI Error - 2026-09-03T04:24:23.567Z

| Field | Value |
|-------|-------|
| Operation | unknown |
| Model | perplexity/sonar-pro-search |
| Provider | openrouter |
| Connector Source | system |
| Connector ID | df13eefe-56bb-4f0b-902f-cdf9cb865ab8 |
| Connector Name | Openrouter |

### Error Details
- **Type**: AuthenticationError
- **Message**: 401 Missing Authentication header
- **Retryable**: false

<details>
<summary>Stack Trace</summary>

```
Error: 401 Missing Authentication header
    at Function.generate (C:\Users\Scofieldkoh\Documents\oakcloud\node_modules\openai\src\error.ts:76:14)
    at OpenAI.makeStatusError (C:\Users\Scofieldkoh\Documents\oakcloud\node_modules\openai\src\core.ts:462:21)
    at OpenAI.makeRequest (C:\Users\Scofieldkoh\Documents\oakcloud\node_modules\openai\src\core.ts:526:24)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async callOpenRouter (C:\Users\Scofieldkoh\Documents\oakcloud\src\lib\ai\providers\openrouter.ts:177:16)
    at async callAIWithConnector (C:\Users\Scofieldkoh\Documents\oakcloud\src\lib\ai\index.ts:531:22)
    at async [eval]:11:18
```
</details>

---

