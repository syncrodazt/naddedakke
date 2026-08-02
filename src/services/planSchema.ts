// JSON Schema for a lesson plan, for providers that support structured output.
// Same strict-mode rules as the other schemas: every property required, no
// extras. Shape only — parsePlan still validates what comes back.

export const LESSON_PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['steps'],
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'gist'],
        properties: {
          title: { type: 'string' },
          gist: { type: 'string' },
        },
      },
    },
  },
};
