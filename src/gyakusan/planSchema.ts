// JSON Schema for a back-cast plan, sent to providers that support structured
// output (Anthropic `output_config.format`). It removes a whole class of
// failure — prose around the JSON, a fenced code block, a missing field — but
// it is NOT validation: a schema-conforming plan can still reference an unknown
// name or form a cycle, so `parseGoalPlan` still checks everything afterwards.
//
// Strict-mode rules: every property listed in `required`, `additionalProperties`
// false throughout. Optional-in-our-model fields (`note`) are required here and
// may be sent empty; the parser drops empty ones.

const NUMBER = { type: 'number' } as const;
const STRING = { type: 'string' } as const;

export const GOAL_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'goalLabel', 'goalNote', 'variables', 'derived', 'goalOf'],
  properties: {
    title: STRING,
    goalLabel: STRING,
    goalNote: STRING,
    variables: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'label', 'value', 'unit', 'min', 'max', 'step'],
        properties: {
          // snake_case identifier the formulas reference.
          name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
          label: STRING,
          value: NUMBER,
          unit: STRING,
          min: NUMBER,
          max: NUMBER,
          step: NUMBER,
        },
      },
    },
    derived: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'label', 'formula', 'unit', 'note'],
        properties: {
          name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
          label: STRING,
          // mathjs expression over names defined in this same object.
          formula: STRING,
          unit: STRING,
          note: STRING,
        },
      },
    },
    goalOf: STRING,
  },
};
