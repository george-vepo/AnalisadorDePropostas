import type { RunbookItem } from '../pipeline';
import { evaluateWhen } from './conditions';

export type MatchedRunbook = {
  id: string;
  title: string;
  steps: string[];
  links: string[];
  severitySuggestion: RunbookItem['severitySuggestion'];
};

const MAX_RUNBOOKS = 10;

export const matchRunbooks = (
  normalizedRawJson: unknown,
  signals: Record<string, unknown>,
  runbooks: RunbookItem[],
): MatchedRunbook[] => {
  const matched: MatchedRunbook[] = [];

  for (const item of runbooks) {
    if (evaluateWhen(item.when, normalizedRawJson, signals)) {
      matched.push({
        id: item.id,
        title: item.title,
        steps: item.steps,
        links: item.links,
        severitySuggestion: item.severitySuggestion,
      });
    }

    if (matched.length >= MAX_RUNBOOKS) break;
  }

  return matched;
};
