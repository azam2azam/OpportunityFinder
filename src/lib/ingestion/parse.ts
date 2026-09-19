import type { DomainSpec, TargetField } from './domains'

/**
 * CSV parsing, coercion and row validation.
 *
 * Written by hand rather than pulled from a library because the requirements
 * are specific: every failure must carry a row number, a field name and the
 * offending raw value, since an integrator fixing a rejected file needs to know
 * exactly which cell to look at. A generic parser gives you a thrown error and
 * a character offset.
 */

export interface ParsedRow {
  /** 1-based, counting the header as row 1 — matches what a spreadsheet shows. */
  rowNumber: number
  values: Record<string, string>
}

export interface ParseResult {
  headers: string[]
  rows: ParsedRow[]
  /** Headers in the file that the domain does not define. */
  unknownHeaders: string[]
  /** Required domain fields with no column in the file. */
  missingRequired: string[]
}

/**
 * RFC 4180 CSV: quoted fields, doubled quotes inside them, embedded newlines
 * and commas. A naive `split(',')` corrupts any clinical note containing a
 * comma, which is most of them.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // Strip a UTF-8 BOM — Excel writes one, and it would otherwise become part
  // of the first header name and break the mapping silently.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  while (i < text.length) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }

    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += c
    i++
  }

  // Trailing field, unless the file ended on a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((c) => c.trim().length > 0))
}

export function parseForDomain(text: string, domain: DomainSpec): ParseResult {
  const raw = parseCsv(text)
  if (raw.length === 0) {
    return { headers: [], rows: [], unknownHeaders: [], missingRequired: domain.fields.filter((f) => f.required).map((f) => f.name) }
  }

  const headers = raw[0].map((h) => h.trim().toLowerCase())
  const known = new Set(domain.fields.map((f) => f.name))

  const rows: ParsedRow[] = raw.slice(1).map((cells, index) => {
    const values: Record<string, string> = {}
    headers.forEach((h, colIndex) => {
      values[h] = (cells[colIndex] ?? '').trim()
    })
    return { rowNumber: index + 2, values }
  })

  return {
    headers,
    rows,
    unknownHeaders: headers.filter((h) => !known.has(h)),
    missingRequired: domain.fields.filter((f) => f.required && !headers.includes(f.name)).map((f) => f.name),
  }
}

// ── coercion ────────────────────────────────────────────────────────────

export interface CoercionError {
  field: string
  code: string
  message: string
  rawValue: string
}

export type Coerced =
  | { ok: true; value: string | number | boolean | Date | null }
  | { ok: false; error: CoercionError }

const TRUE_VALUES = new Set(['true', '1', 'y', 'yes', 't'])
const FALSE_VALUES = new Set(['false', '0', 'n', 'no', 'f'])

export function coerce(field: TargetField, raw: string): Coerced {
  const value = raw.trim()

  if (value === '') {
    if (field.required) {
      return {
        ok: false,
        error: {
          field: field.name,
          code: 'REQUIRED_FIELD_EMPTY',
          message: `${field.name} is required and was empty.`,
          rawValue: raw,
        },
      }
    }
    return { ok: true, value: null }
  }

  switch (field.type) {
    case 'string':
      return { ok: true, value }

    case 'enum': {
      const upper = value.toUpperCase()
      if (!field.values?.includes(upper)) {
        return {
          ok: false,
          error: {
            field: field.name,
            code: 'INVALID_ENUM',
            message: `${field.name} must be one of ${field.values?.join(', ')}.`,
            rawValue: raw,
          },
        }
      }
      return { ok: true, value: upper }
    }

    case 'boolean': {
      const lower = value.toLowerCase()
      if (TRUE_VALUES.has(lower)) return { ok: true, value: true }
      if (FALSE_VALUES.has(lower)) return { ok: true, value: false }
      return {
        ok: false,
        error: {
          field: field.name,
          code: 'INVALID_BOOLEAN',
          message: `${field.name} must be true/false (also accepts 1/0, yes/no).`,
          rawValue: raw,
        },
      }
    }

    case 'integer':
    case 'number': {
      // Thousands separators are common in finance extracts and are not an
      // error worth rejecting a claim over.
      const cleaned = value.replace(/,/g, '')
      const n = Number(cleaned)
      if (!Number.isFinite(n)) {
        return {
          ok: false,
          error: { field: field.name, code: 'INVALID_NUMBER', message: `${field.name} is not a number.`, rawValue: raw },
        }
      }
      if (field.type === 'integer' && !Number.isInteger(n)) {
        return {
          ok: false,
          error: { field: field.name, code: 'INVALID_INTEGER', message: `${field.name} must be a whole number.`, rawValue: raw },
        }
      }
      if (field.min != null && n < field.min) {
        return {
          ok: false,
          error: { field: field.name, code: 'BELOW_MINIMUM', message: `${field.name} must be at least ${field.min}.`, rawValue: raw },
        }
      }
      if (field.max != null && n > field.max) {
        return {
          ok: false,
          error: { field: field.name, code: 'ABOVE_MAXIMUM', message: `${field.name} must be at most ${field.max}.`, rawValue: raw },
        }
      }
      return { ok: true, value: n }
    }

    case 'date':
    case 'datetime': {
      const parsed = parseDate(value)
      if (!parsed) {
        return {
          ok: false,
          error: {
            field: field.name,
            code: 'INVALID_DATE',
            message: `${field.name} must be ISO 8601 (2026-06-18 or 2026-06-18T10:30:00Z). Ambiguous formats like 06/18/2026 are rejected rather than guessed.`,
            rawValue: raw,
          },
        }
      }
      return { ok: true, value: parsed }
    }

    default:
      return { ok: true, value }
  }
}

/**
 * Accepts ISO 8601 only.
 *
 * `01/02/2026` is the second of January in one country and the first of
 * February in another, and a clinical platform that guesses wrong shifts a
 * follow-up window by a month. Rejecting the ambiguous case and telling the
 * integrator to send ISO is the safe behaviour.
 */
function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
    return null
  }
  const normalised = value.includes('T') ? value : value.replace(' ', 'T')
  const withZone = /[T]/.test(normalised) && !/(Z|[+-]\d{2}:?\d{2})$/.test(normalised)
    ? `${normalised}Z`
    : normalised.includes('T')
      ? normalised
      : `${normalised}T00:00:00Z`
  const d = new Date(withZone)
  return Number.isNaN(d.getTime()) ? null : d
}
