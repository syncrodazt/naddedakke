import type { NodeTypes } from '@xyflow/react';
import { ChunkNode } from './ChunkNode';
import { QuestionNode } from './QuestionNode';
import { AnswerNode } from './AnswerNode';
import { PlaygroundNode } from './PlaygroundNode';
import { VariableNode } from './VariableNode';
import { DerivedNode } from './DerivedNode';
import { GoalNode } from './GoalNode';
import { VideoNode } from './VideoNode';

// One component per NodeKind.
export const nodeTypes: NodeTypes = {
  chunk: ChunkNode,
  question: QuestionNode,
  answer: AnswerNode,
  playground: PlaygroundNode,
  variable: VariableNode,
  derived: DerivedNode,
  goal: GoalNode,
  video: VideoNode,
};
