import type { NodeTypes } from '@xyflow/react';
import { ChunkNode } from './ChunkNode';
import { QuestionNode } from './QuestionNode';
import { AnswerNode } from './AnswerNode';
import { PlaygroundNode } from './PlaygroundNode';

// One component per NodeKind; kinds without a component yet (gyakusan kinds,
// video) fall back to React Flow's default node until built.
export const nodeTypes: NodeTypes = {
  chunk: ChunkNode,
  question: QuestionNode,
  answer: AnswerNode,
  playground: PlaygroundNode,
};
