export const normalizeFieldName = (name: unknown): string => {
  if (name === null || name === undefined) return '';
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
};
