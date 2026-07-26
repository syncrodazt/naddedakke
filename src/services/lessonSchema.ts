// JSON Schema for one lesson chunk, for providers that support structured
// output (Anthropic `output_config.format`). Same strict-mode rules as the
// back-cast plan schema: every property required, no extras.
//
// It is a guarantee about *shape*, not about content — LessonStreamParser still
// validates what comes back, and a provider that ignores the schema entirely
// still works through the raw-markdown path.

export const LESSON_CHUNK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['chunkTitle', 'md', 'checkQuestion', 'done'],
  properties: {
    chunkTitle: { type: 'string' },
    // Markdown body. The comprehension question is deliberately NOT in here:
    // the app appends it in the one blockquote form findCheckRange recognises.
    md: { type: 'string' },
    checkQuestion: { type: 'string' },
    /** True only on the final chunk of the lesson. */
    done: { type: 'boolean' },
  },
};
