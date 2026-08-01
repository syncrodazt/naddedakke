// JSON Schema for a proposed concept map, for providers that support
// structured output. Shape only — parseConceptMap still checks everything that
// matters, including that notebook ids are real.

export const CONCEPT_MAP_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['concepts'],
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'area', 'blurb', 'prereqs', 'sessionIds', 'why'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          area: { type: 'string' },
          blurb: { type: 'string' },
          prereqs: { type: 'array', items: { type: 'string' } },
          sessionIds: { type: 'array', items: { type: 'string' } },
          why: { type: 'string' },
        },
      },
    },
  },
};
