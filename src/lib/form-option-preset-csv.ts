import {
  FORM_PRESET_MAX_FILE_BYTES,
  FORM_PRESET_MAX_OPTIONS,
  type PresetOption,
} from '@/lib/validations/form-option-preset';

export type PresetCsvError = {
  row: number;
  column?: string;
  code: string;
  message: string;
};

export type PresetCsvResult = {
  detectedColumns: string[];
  options: PresetOption[];
  errors: PresetCsvError[];
  totalRows: number;
  rejectedRows: number;
};

type ParsedRow = { cells: string[]; row: number };

function parseRows(input: string): { rows: ParsedRow[]; error: PresetCsvError | null } {
  const rows: ParsedRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let physicalRow = 1;
  let rowStart = 1;

  const finishCell = () => {
    cells.push(cell);
    cell = '';
  };
  const finishRow = () => {
    finishCell();
    rows.push({ cells, row: rowStart });
    cells = [];
    rowStart = physicalRow + 1;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += character;
        if (character === '\n') physicalRow += 1;
      }
      continue;
    }

    if (character === '"') {
      if (cell.length > 0) {
        return {
          rows,
          error: { row: physicalRow, code: 'malformed_csv', message: 'Unexpected quote in unquoted cell' },
        };
      }
      inQuotes = true;
    } else if (character === ',') {
      finishCell();
    } else if (character === '\n') {
      finishRow();
      physicalRow += 1;
      rowStart = physicalRow;
    } else if (character === '\r') {
      if (input[index + 1] === '\n') index += 1;
      finishRow();
      physicalRow += 1;
      rowStart = physicalRow;
    } else {
      cell += character;
    }
  }

  if (inQuotes) {
    return {
      rows,
      error: { row: rowStart, code: 'malformed_csv', message: 'Unterminated quoted cell' },
    };
  }

  if (cell.length > 0 || cells.length > 0) {
    finishRow();
  }

  return { rows, error: null };
}

function isBlankRow(row: ParsedRow): boolean {
  return row.cells.every((cell) => cell.trim().length === 0);
}

export function parsePresetCsv(csv: string): PresetCsvResult {
  const emptyResult: PresetCsvResult = {
    detectedColumns: [],
    options: [],
    errors: [],
    totalRows: 0,
    rejectedRows: 0,
  };

  if (new TextEncoder().encode(csv).byteLength > FORM_PRESET_MAX_FILE_BYTES) {
    return {
      ...emptyResult,
      errors: [{ row: 1, code: 'file_too_large', message: 'CSV file must be 5 MB or smaller' }],
    };
  }

  const normalizedInput = csv.startsWith('\uFEFF') ? csv.slice(1) : csv;
  const parsed = parseRows(normalizedInput);
  if (parsed.error) {
    return { ...emptyResult, errors: [parsed.error] };
  }

  const nonBlankRows = parsed.rows.filter((row) => !isBlankRow(row));
  const headerRow = nonBlankRows[0];
  if (!headerRow) {
    return {
      ...emptyResult,
      errors: [{ row: 1, code: 'invalid_headers', message: 'CSV must contain a label header' }],
    };
  }

  const detectedColumns = headerRow.cells.map((cell) => cell.trim().toLowerCase());
  const valueIndex = detectedColumns.indexOf('value');
  const labelIndex = detectedColumns.indexOf('label');
  if (labelIndex === -1 || detectedColumns.some((column) => column !== 'value' && column !== 'label')) {
    return {
      ...emptyResult,
      detectedColumns,
      errors: [{
        row: headerRow.row,
        code: 'invalid_headers',
        message: 'CSV headers must be label or value,label',
      }],
    };
  }

  const dataRows = nonBlankRows.slice(1);
  const options: PresetOption[] = [];
  const errors: PresetCsvError[] = [];
  const seenValues = new Set<string>();
  let rejectedRows = 0;

  for (const row of dataRows) {
    const label = (row.cells[labelIndex] || '').trim();
    const value = valueIndex === -1 ? label : (row.cells[valueIndex] || '').trim();
    const rowErrors: PresetCsvError[] = [];

    if (!value) {
      rowErrors.push({ row: row.row, column: 'value', code: 'required', message: 'Value is required' });
    }
    if (!label) {
      rowErrors.push({ row: row.row, column: 'label', code: 'required', message: 'Label is required' });
    }
    if (value && seenValues.has(value)) {
      rowErrors.push({ row: row.row, column: 'value', code: 'duplicate_value', message: `Duplicate value: ${value}` });
    }
    if (value.length > 200) {
      rowErrors.push({ row: row.row, column: 'value', code: 'value_too_long', message: 'Value must be at most 200 characters' });
    }
    if (label.length > 500) {
      rowErrors.push({ row: row.row, column: 'label', code: 'label_too_long', message: 'Label must be at most 500 characters' });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      rejectedRows += 1;
      continue;
    }

    if (options.length >= FORM_PRESET_MAX_OPTIONS) {
      errors.push({
        row: row.row,
        code: 'too_many_options',
        message: `Preset lists support at most ${FORM_PRESET_MAX_OPTIONS} options`,
      });
      rejectedRows += 1;
      continue;
    }

    seenValues.add(value);
    options.push({ value, label });
  }

  return {
    detectedColumns,
    options,
    errors,
    totalRows: dataRows.length,
    rejectedRows,
  };
}
