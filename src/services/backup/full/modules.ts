/**
 * The modules a full backup can be restored by. Every application table
 * belongs to exactly one module (a test checks this against the schema);
 * tables no module names fall into "Other".
 */

export interface BackupModule {
  key: string;
  label: string;
  description: string;
}

interface ModuleRule extends BackupModule {
  tables?: string[];
  prefixes?: string[];
}

const RULES: ModuleRule[] = [
  {
    key: 'users',
    label: 'Users and access',
    description: 'Accounts, passwords, roles, permissions and company assignments',
    tables: ['users', 'roles', 'permissions', 'role_permissions', 'user_role_assignments', 'user_company_assignments', 'user_preferences', 'client_portal_users'],
  },
  {
    key: 'workspaces',
    label: 'Workspaces and settings',
    description: 'Workspaces, letterheads, exchange rates and webhooks',
    tables: ['tenants', 'tenant_letterheads', 'exchange_rates', 'idempotency_records', 'performance_measurements', 'webhook_subscriptions', 'backup_schedules'],
  },
  {
    key: 'connectors',
    label: 'Connectors',
    description: 'Connectors, their keys and which workspaces may use them',
    tables: ['connectors', 'connector_model_configs', 'connector_usage_logs', 'workspace_connector_access', 'accounting_integrations'],
  },
  {
    key: 'companies',
    label: 'Companies',
    description: 'Companies, officers, shareholders, addresses, notes and BizFile records',
    tables: ['companies', 'share_capital', 'note_tabs'],
    prefixes: ['company_', 'bizfile_'],
  },
  {
    key: 'contacts',
    label: 'Contacts',
    description: 'Contacts, their details and company links',
    tables: ['contacts', 'company_contacts'],
    prefixes: ['contact_'],
  },
  {
    key: 'services',
    label: 'Services and agreements',
    description: 'Service catalog, client services, fee lines and service agreements',
    prefixes: ['service_', 'client_service'],
  },
  {
    key: 'deadlines',
    label: 'Deadlines and compliance',
    description: 'Deadline rules, deadlines, compliance monitoring and business calendars',
    tables: ['business_calendars', 'business_holidays', 'company_monitoring_coverages', 'company_compliance_issues', 'client_service_deadline_rules'],
    prefixes: ['deadline_', 'public_holiday_'],
  },
  {
    key: 'billing',
    label: 'Billing',
    description: 'Billing entries and billing issues',
    prefixes: ['billing_'],
  },
  {
    key: 'documents',
    label: 'Documents and bookkeeping',
    description: 'Document vault, processed documents, bank accounts, matching and chart of accounts',
    tables: [
      'documents', 'document_pages', 'document_derived_files', 'document_state_events', 'document_extractions',
      'document_revisions', 'document_revision_line_items', 'document_links', 'document_tags', 'duplicate_decisions',
      'split_plans', 'field_mappings', 'reconciliation_periods', 'external_postings', 'customer_aliases', 'vendor_aliases',
    ],
    prefixes: ['processing_', 'chart_of_accounts', 'bank_', 'match_group'],
  },
  {
    key: 'templates',
    label: 'Document templates and generated documents',
    description: 'Templates, partials, generated documents, drafts and comments',
    tables: ['document_templates', 'template_partials', 'generated_documents', 'document_drafts', 'document_sections', 'document_comments'],
    prefixes: ['document_generation_'],
  },
  {
    key: 'esigning',
    label: 'E-signing',
    description: 'Envelopes, recipients, fields, emails and SharePoint filing',
    prefixes: ['esigning_'],
  },
  {
    key: 'forms',
    label: 'Forms',
    description: 'Forms, fields, submissions and uploads',
    tables: ['forms'],
    prefixes: ['form_'],
  },
  {
    key: 'tasks',
    label: 'Tasks and pipelines',
    description: 'Tasks, stages, checklists and pipeline templates',
    tables: ['tasks'],
    prefixes: ['task_'],
  },
  {
    key: 'assistant',
    label: 'Business Assistant',
    description: 'Assistant conversations, runs, memories and approvals',
    tables: ['ai_conversations'],
    prefixes: ['business_assistant_'],
  },
  {
    key: 'communications',
    label: 'Communications',
    description: 'Emails, messages and client requests',
    tables: ['communications', 'client_requests'],
  },
  {
    key: 'audit',
    label: 'Audit log',
    description: 'The history of who changed what',
    tables: ['audit_logs'],
  },
];

export const OTHER_MODULE: BackupModule = {
  key: 'other',
  label: 'Other',
  description: 'Tables not listed in any other module',
};

/** Settings of this machine that a module restore never changes. */
export const MODULE_RESTORE_SKIPPED_TABLES = new Set(['backup_settings']);

export const BACKUP_MODULES: BackupModule[] = [
  ...RULES.map(({ key, label, description }) => ({ key, label, description })),
  OTHER_MODULE,
];

/** Exact table names win over prefixes, so e.g. company_contacts sits with Contacts. */
export function moduleForTable(table: string): string {
  const exact = RULES.find((rule) => rule.tables?.includes(table));
  if (exact) return exact.key;
  const byPrefix = RULES.find((rule) => rule.prefixes?.some((prefix) => table.startsWith(prefix)));
  return byPrefix?.key ?? OTHER_MODULE.key;
}

export function moduleLabel(key: string): string {
  return BACKUP_MODULES.find((module) => module.key === key)?.label ?? key;
}

export function isBackupModuleKey(key: string): boolean {
  return BACKUP_MODULES.some((module) => module.key === key);
}
