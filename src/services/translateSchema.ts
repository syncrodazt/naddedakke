// JSON Schema for a batch translation, for providers that support structured
// output (Anthropic `output_config.format`). Same strict-mode rules as the
// other schemas: every property required, no extras.
//
// Shape only. parseTranslation still checks what comes back — in particular
// that each quote really occurs in the body it was translated with, which no
// schema can express.

export const TRANSLATE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'sourceLang', 'md', 'quotes'],
        properties: {
          id: { type: 'string' },
          sourceLang: { type: 'string' },
          md: { type: 'string' },
          quotes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'text'],
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};
