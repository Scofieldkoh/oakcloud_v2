# Ralph PRD Converter Skill

Convert a markdown PRD into prd.json format for autonomous execution.

## Input

Read the markdown PRD file (e.g., `ralph-claude/prd-[feature-name].md`)

## Critical Rules

### Story Sizing (MOST IMPORTANT)

Each story MUST be completable in ONE iteration (one context window).

**Right-sized stories:**
- Add a database migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list
- Create a new API endpoint

**TOO BIG (must be split):**
- "Build the entire dashboard"
- "Add authentication"
- "Implement the settings page"

If you encounter stories that are too big, split them into smaller, focused tasks.

### Dependency Ordering

Stories execute by priority number. Ensure correct sequencing:
1. Schema/database changes first (priority 1, 2, ...)
2. Backend logic second (priority N+1, ...)
3. UI components that depend on backend last (priority N+M, ...)

### Acceptance Criteria Rules

- Must be verifiable and specific
- NEVER use vague criteria like "works correctly" or "good UX"
- EVERY story must include: "TypeScript typecheck passes"
- UI stories must include: "Verify in browser using browser tool"

## Output Format

```json
{
  "project": "Oakcloud",
  "branchName": "ralph/[feature-name-kebab-case]",
  "description": "Brief feature description",
  "userStories": [
    {
      "id": "US-001",
      "title": "Short title",
      "description": "As a [user], I want [action] so [benefit]",
      "acceptanceCriteria": [
        "Specific criterion 1",
        "Specific criterion 2",
        "TypeScript typecheck passes"
      ],
      "priority": 1,
      "passes": false,
      "notes": "Optional implementation hints"
    }
  ]
}
```

## Field Descriptions

| Field | Description |
|-------|-------------|
| `project` | Always "Oakcloud" |
| `branchName` | Git branch in format `ralph/[feature-name-kebab-case]` |
| `description` | One-line summary of what this sprint implements |
| `userStories` | Array of user story objects |
| `id` | Unique identifier (US-001, US-002, etc.) |
| `title` | Short title (5-10 words) |
| `description` | Full user story in "As a... I want... so..." format |
| `acceptanceCriteria` | Array of specific, verifiable criteria |
| `priority` | Numeric priority (1 = highest, executed first) |
| `passes` | Always `false` initially (set to `true` when completed) |
| `notes` | Optional implementation hints or context |

## Pre-Conversion Checklist

Before saving prd.json, verify:

- [ ] Each story completable in one iteration?
- [ ] Dependencies ordered correctly (schema → backend → UI)?
- [ ] Every story has "TypeScript typecheck passes" criterion?
- [ ] All criteria are measurable, not subjective?
- [ ] UI stories have browser verification criterion?
- [ ] Branch name is kebab-case with ralph/ prefix?

## Output

Save to: `docs/prd.json`

## Example Conversion

**Input (from markdown PRD):**
```
### User Stories

1. As an admin, I want to toggle dark mode so I can work comfortably at night.
   - Toggle visible in sidebar
   - Theme persists across sessions
```

**Output (prd.json):**
```json
{
  "project": "Oakcloud",
  "branchName": "ralph/dark-mode-toggle",
  "description": "Add dark mode toggle to the application",
  "userStories": [
    {
      "id": "US-001",
      "title": "Add dark mode toggle to sidebar",
      "description": "As an admin, I want to toggle dark mode so I can work comfortably at night",
      "acceptanceCriteria": [
        "Toggle button visible in sidebar",
        "Theme persists across sessions using localStorage",
        "TypeScript typecheck passes",
        "Verify in browser using browser tool"
      ],
      "priority": 1,
      "passes": false,
      "notes": "Use existing ThemeProvider pattern if available"
    }
  ]
}
```
