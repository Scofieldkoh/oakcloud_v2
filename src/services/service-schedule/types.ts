/**
 * Public, serializable contracts for service schedule evaluation.
 *
 * DateOnly deliberately remains a string at the boundary. Runtime callers
 * must use the date-only parser before doing arithmetic; the template literal
 * only documents the wire format to TypeScript consumers.
 */
export type DateOnly = `${number}-${number}-${number}`;

export type BusinessDayAdjustment = 'NONE' | 'PREVIOUS' | 'NEXT';

export type DateSource =
  | {
      kind: 'COMPANY_FIELD';
      field:
        | 'financialYearEnd'
        | 'accountsDueDate'
        | 'incorporationDate';
    }
  | { kind: 'CYCLE_START' | 'CYCLE_END' }
  /**
   * The explicit financial period an obligation belongs to. Unlike the
   * Company.financialYearEnd landmark it is never realigned to an anniversary.
   */
  | { kind: 'OBLIGATION_PERIOD_START' | 'OBLIGATION_PERIOD_END' }
  | { kind: 'PARAMETER'; key: string }
  | { kind: 'SCHEDULE_ENTRY'; key: string }
  | { kind: 'MILESTONE'; key: string }
  | { kind: 'CURRENT_SCHEDULE_ENTRY' };

/** Integer operation operands may be persisted literals or typed parameters. */
export type IntegerOperand = number | { kind: 'INTEGER_PARAMETER'; key: string };

export type ScheduleEntryExpression =
  | { kind: 'DAY_OF_MONTH'; day: number }
  | { kind: 'BUSINESS_DAY_FROM_START'; ordinal: number }
  | { kind: 'BUSINESS_DAY_FROM_END'; ordinal: number }
  | {
      kind: 'RELATIVE_TO_SOURCE';
      source: DateSource;
      offset: IntegerOperand;
      unit: 'CALENDAR_DAY' | 'BUSINESS_DAY';
    };

export type ScheduleEntry = {
  key: string;
  label: string;
  expression: ScheduleEntryExpression;
  businessDayAdjustment: BusinessDayAdjustment;
};

export type DateOperation =
  | {
      kind: 'RELATIVE_TO_SOURCE';
      source: DateSource;
      offset: IntegerOperand;
      unit: 'CALENDAR_DAY' | 'BUSINESS_DAY';
    }
  | {
      kind: 'ADD';
      source?: DateSource;
      offset: IntegerOperand;
      unit: 'CALENDAR_DAY' | 'BUSINESS_DAY';
    }
  | { kind: 'ADD_CALENDAR_DAYS'; source?: DateSource; amount: IntegerOperand }
  | { kind: 'ADD_BUSINESS_DAYS'; source?: DateSource; amount: IntegerOperand }
  | { kind: 'ADD_MONTHS'; source?: DateSource; amount: IntegerOperand }
  /** Month arithmetic that maps a month-end source to the target month end. */
  | { kind: 'ADD_MONTHS_MONTH_END'; source?: DateSource; amount: IntegerOperand }
  /** A fixed calendar date in the obligation period's Year of Assessment. */
  | { kind: 'FIXED_DATE_IN_ASSESSMENT_YEAR'; month: number; day: number }
  | {
      kind: 'FIXED_DATE_FROM_SOURCE_YEAR';
      source: DateSource;
      yearOffset: number;
      month: number;
      day: number;
    }
  | { kind: 'ADJUST_BUSINESS_DAY'; adjustment: BusinessDayAdjustment };

export type DirectSourceExpression = { kind: 'SOURCE'; source: DateSource };
export type CoalesceExpression = { kind: 'COALESCE'; candidates: MilestoneExpression[] };

/** The versioned expression language persisted by milestones and consumers. */
export type MilestoneExpression = ScheduleEntryExpression
  | DateOperation
  | DirectSourceExpression
  | CoalesceExpression;
export type DateExpression = MilestoneExpression;

export type RuleRecurrenceDefinition =
  | { schemaVersion: 1; kind: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY'; interval?: number }
  | { schemaVersion: 1; kind: 'ONE_TIME' }
  | { schemaVersion: 1; kind: 'CUSTOM'; interval: number; unit: 'MONTH' };

export type RuleRecurrence = RuleRecurrenceDefinition;

export type MilestoneDefinition = {
  key: string;
  name: string;
  description: string | null;
  type: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  generationMode: 'ONCE_PER_CYCLE' | 'ONCE_PER_SCHEDULE_ENTRY';
  expression: MilestoneExpression;
  businessDayAdjustment: BusinessDayAdjustment;
  displayOrder: number;
  isActive: boolean;
};

export type BooleanCompanyField =
  | 'isGstRegistered'
  | 'isRegisteredCharity'
  | 'isIPC'
  | 'hasCharges';

export type NumericCompanyField =
  | 'currentOfficerCount'
  | 'currentShareholderCount'
  | 'annualReceiptsOrExpenditure';

export type DateCompanyField =
  | 'financialYearEnd'
  | 'accountsDueDate'
  | 'incorporationDate'
  | 'registrationDate';

export type StringCompanyField =
  | 'entityType'
  | 'status'
  | 'primarySsicCode'
  | 'secondarySsicCode'
  | 'uen'
  | 'name';

export type CompanyField = BooleanCompanyField | NumericCompanyField | DateCompanyField | StringCompanyField;

/** The runtime predicate schema's field-to-value compatibility map. */
export type CompanyFieldValueMap = {
  [Field in BooleanCompanyField]: boolean;
} & {
  [Field in NumericCompanyField]: number;
} & {
  [Field in DateCompanyField]: string;
} & {
  [Field in StringCompanyField]: string;
};

export type CompanyFieldValue = CompanyFieldValueMap[CompanyField];
export type CompanyRuleSource = Partial<CompanyFieldValueMap>;

type EqualityApplicabilityPredicate<Kind extends 'FIELD_EQUALS' | 'FIELD_NOT_EQUALS'> = {
  [Field in CompanyField]: {
    kind: Kind;
    field: Field;
    value: CompanyFieldValueMap[Field];
  };
}[CompanyField];

type ListApplicabilityPredicate<Kind extends 'FIELD_IN' | 'FIELD_NOT_IN'> = {
  [Field in CompanyField]: {
    kind: Kind;
    field: Field;
    values: Array<CompanyFieldValueMap[Field]>;
  };
}[CompanyField];

type BooleanApplicabilityPredicate<Kind extends 'FIELD_TRUE' | 'FIELD_FALSE'> = {
  [Field in BooleanCompanyField]: {
    kind: Kind;
    field: Field;
  };
}[BooleanCompanyField];

type PresenceApplicabilityPredicate<Kind extends 'FIELD_PRESENT' | 'FIELD_MISSING'> = {
  kind: Kind;
  field: CompanyField;
};

export type ComparisonOperator = 'GT' | 'GTE' | 'LT' | 'LTE';

type CompareApplicabilityPredicate = {
  [Field in NumericCompanyField]: {
    kind: 'FIELD_COMPARE';
    field: Field;
    operator: ComparisonOperator;
    value: number;
  };
}[NumericCompanyField] | {
  [Field in DateCompanyField]: {
    kind: 'FIELD_COMPARE';
    field: Field;
    operator: ComparisonOperator;
    value: string;
  };
}[DateCompanyField];

export type ApplicabilityPredicate =
  | EqualityApplicabilityPredicate<'FIELD_EQUALS'>
  | EqualityApplicabilityPredicate<'FIELD_NOT_EQUALS'>
  | ListApplicabilityPredicate<'FIELD_IN'>
  | ListApplicabilityPredicate<'FIELD_NOT_IN'>
  | BooleanApplicabilityPredicate<'FIELD_TRUE'>
  | BooleanApplicabilityPredicate<'FIELD_FALSE'>
  | PresenceApplicabilityPredicate<'FIELD_PRESENT'>
  | PresenceApplicabilityPredicate<'FIELD_MISSING'>
  | CompareApplicabilityPredicate;

export type ApplicabilityGroup = {
  kind: 'ALL' | 'ANY';
  conditions: Array<ApplicabilityPredicate | ApplicabilityGroup>;
};

export type ApplicabilityDefinition = ApplicabilityGroup & { schemaVersion: 1 };

export type DeadlineParameterDefinition = {
  key: string;
  label: string;
  description?: string | null;
  type: 'STRING' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DATE' | 'ENUM';
  required: boolean;
  options?: string[];
};

/**
 * The explicit financial/tax period an evaluation belongs to. Required only by
 * expressions that use OBLIGATION_PERIOD_* sources or the assessment year.
 */
export type ObligationPeriodInput = {
  start: DateOnly;
  end: DateOnly;
  yearOfAssessment: number | null;
};

export type BusinessCalendarSnapshot = {
  id: string;
  timeZone: string;
  weekendDays: ReadonlySet<number>;
  holidays: ReadonlySet<DateOnly>;
  revision: number;
};
