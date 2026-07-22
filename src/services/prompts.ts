import type { AnswerRequest, LessonChunkRequest } from './claude/types';
import { LESSON_DONE_MARKER } from './claude/types';

// Prompt construction is provider-agnostic: every service receives a plain
// {system, user} pair and maps it onto its own wire format.

export type ChatPrompt = { system: string; user: string };

const TUTOR_PERSONA =
  'あなたは第一原理から教える家庭教師です。日本語で、簡潔で正確なMarkdownで答えてください。' +
  '数式はKaTeX記法（$...$ / $$...$$）を使ってよい。生のHTMLは書かない。';

export function buildAnswerPrompt(req: AnswerRequest): ChatPrompt {
  return {
    system:
      `${TUTOR_PERSONA}\n` +
      '生徒がレッスン本文の一部をハイライトして「なんで？」と質問しています。' +
      'ハイライトされた箇所そのものを、根本の理由から説明してください。' +
      '長さは150〜250語程度。結論を先に、導出は後に。',
    user:
      `## これまでの文脈（レッスンの祖先チェーン）\n\n${req.contextMd || '(なし)'}\n\n` +
      `## ハイライトされた箇所\n\n> ${req.quotedText}\n\n` +
      `## 質問\n\n${req.question}`,
  };
}

export function buildLessonChunkPrompt(req: LessonChunkRequest): ChatPrompt {
  const previous =
    req.previousChunksMd.length > 0
      ? req.previousChunksMd.map((md, i) => `### チャンク${i + 1}\n${md}`).join('\n\n')
      : '(まだない)';
  return {
    system:
      `${TUTOR_PERSONA}\n` +
      'トピックを約10個の小さなチャンクに分けて、ソクラテス式に一歩ずつ教えます。' +
      '今回は次の1チャンクだけを書いてください。全部を一度に書いてはいけません。\n' +
      '形式: 1行目は「## タイトル」、本文は150〜250語のMarkdown。\n' +
      `これがレッスンの最終チャンクなら、本文の後に改行して「${LESSON_DONE_MARKER}」とだけ書いた行を追加してください。`,
    user:
      `## トピック\n\n${req.topic}\n\n` +
      `## これまでのチャンク\n\n${previous}\n\n` +
      `チャンク${req.chunkIndex + 1}を書いてください。`,
  };
}
