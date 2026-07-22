import type { ComponentType } from 'react';
import { CompoundCurve } from './CompoundCurve';
import { compoundCurveDefaults } from './compound';

export type PlaygroundComponentProps = {
  params: Record<string, number>;
  onParamsChange: (params: Record<string, number>) => void;
};

type PlaygroundEntry = {
  component: ComponentType<PlaygroundComponentProps>;
  defaults: Record<string, number>;
};

// Playground components are first-party code only — a playground node stores
// just a registry key plus serializable params. If LLM-generated interactive
// HTML is ever supported it goes in a sandboxed iframe instead (see CLAUDE.md).
export const playgroundRegistry: Record<string, PlaygroundEntry> = {
  'compound-curve': { component: CompoundCurve, defaults: compoundCurveDefaults },
};
