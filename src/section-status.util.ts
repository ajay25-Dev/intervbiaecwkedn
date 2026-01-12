export type SectionStatus = 'draft' | 'published' | 'archived';

const SECTION_STATUS_VALUES: SectionStatus[] = [
  'draft',
  'published',
  'archived',
];
const SECTION_STATUS_SET = new Set<SectionStatus>(SECTION_STATUS_VALUES);

export function normalizeSectionStatus(
  value: unknown,
  fallback: SectionStatus = 'draft',
): SectionStatus {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return SECTION_STATUS_SET.has(normalized as SectionStatus)
    ? (normalized as SectionStatus)
    : fallback;
}

export function isSectionStatus(value: unknown): value is SectionStatus {
  return SECTION_STATUS_SET.has(
    (value as string)?.toLowerCase() as SectionStatus,
  );
}
