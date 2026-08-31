import { parseIndentedBlocks, renderNestedMarkdownContent } from '@tiptap/core';
import ListItem from '@tiptap/extension-list-item';
import OrderedList from '@tiptap/extension-ordered-list';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';

type MarkdownLexer = {
  inlineTokens: (source: string) => any[];
  blockTokens: (source: string) => any[];
};

const taskItemPattern = /^(\s*)([-+*])\s+\[([ xX])\](?:\s+(.*))?$/;

function parseTaskList(source: string, lexer: MarkdownLexer): any[] | undefined {
  const parseContent = (content: string): any[] | undefined => {
    const result = parseIndentedBlocks(
      content,
      {
        itemPattern: taskItemPattern,
        extractItemData: (match) => ({
          indentLevel: match[1].length,
          mainContent: match[4] ?? '',
          checked: match[3].toLowerCase() === 'x',
        }),
        createToken: (data, nestedTokens) => ({
          type: 'taskItem',
          raw: '',
          mainContent: data.mainContent,
          indentLevel: data.indentLevel,
          checked: data.checked,
          text: data.mainContent,
          tokens: lexer.inlineTokens(data.mainContent),
          nestedTokens,
        }),
        customNestedParser: parseContent,
      },
      lexer,
    );

    if (!result) return lexer.blockTokens(content);

    const taskListToken = { type: 'taskList', raw: result.raw, items: result.items };
    const remainder = content.slice(result.raw.length);
    return remainder.trim() ? [taskListToken, ...lexer.blockTokens(remainder)] : [taskListToken];
  };

  return parseContent(source);
}

function repairOrderedCodeItems(token: any, lexer: MarkdownLexer): any {
  for (const item of token?.items ?? []) {
    const marker = item.raw?.match(/^(\s*)\d+[.)]\s+/);
    if (marker && /(?:```|~~~)/.test(item.raw)) {
      const lines = item.raw.trimEnd().split('\n');
      const fencedLine = lines.slice(1).find((line: string) => /^\s*(?:```|~~~)/.test(line));
      const contentIndent = fencedLine?.match(/^\s*/)?.[0].length ?? marker[0].length;
      const body = [
        lines[0].slice(marker[0].length),
        ...lines
          .slice(1)
          .map((line: string) =>
            line.slice(0, contentIndent).trim() ? line : line.slice(contentIndent),
          ),
      ].join('\n');
      item.tokens = lexer.blockTokens(body);
      item.text = body;
    }

    for (const child of item.tokens ?? []) {
      if (child.type === 'list' && child.ordered) repairOrderedCodeItems(child, lexer);
    }
  }
  return token;
}

export const BlockListItem = ListItem.extend({
  content: 'block+',

  renderMarkdown: (node, helpers, context) => {
    const renderDefault = ListItem.config.renderMarkdown;
    if (!renderDefault || !node.content?.length) return '';

    const emptyItem = { ...node, content: [{ type: 'paragraph' }] };
    const prefix = renderDefault(emptyItem, helpers, context);
    const indentation = ' '.repeat(prefix.length);
    const indentContinuation = (content: string) =>
      content
        .split('\n')
        .map((line, index) => (index === 0 ? line : `${indentation}${line}`))
        .join('\n');
    const [first, ...children] = node.content;
    let output = `${prefix}${indentContinuation(helpers.renderChildren([first]))}`;

    children.forEach((child, index) => {
      const rendered = helpers.renderChild?.(child, index + 1) ?? helpers.renderChildren([child]);
      const indented = rendered
        .split('\n')
        .map((line) => `${indentation}${line}`)
        .join('\n');
      output += child.type === 'paragraph' ? `\n\n${indented}` : `\n${indented}`;
    });

    return output;
  },
});

export const BlockOrderedList = OrderedList.extend({
  markdownTokenizer: {
    ...OrderedList.config.markdownTokenizer!,
    tokenize(source, tokens, lexer) {
      const result = OrderedList.config.markdownTokenizer?.tokenize(source, tokens, lexer);
      return /(?:```|~~~)/.test(source) ? repairOrderedCodeItems(result, lexer) : result;
    },
  },
});

export const BlockTaskList = TaskList.extend({
  markdownTokenizer: {
    name: 'taskList',
    level: 'block',
    start(source) {
      return source.match(/^\s*[-+*]\s+\[([ xX])\](?:\s|$)/)?.index ?? -1;
    },
    tokenize(source, _tokens, lexer) {
      const parsed = parseIndentedBlocks(
        source,
        {
          itemPattern: taskItemPattern,
          extractItemData: (match) => ({
            indentLevel: match[1].length,
            mainContent: match[4] ?? '',
            checked: match[3].toLowerCase() === 'x',
          }),
          createToken: (data, nestedTokens) => ({
            type: 'taskItem',
            raw: '',
            mainContent: data.mainContent,
            indentLevel: data.indentLevel,
            checked: data.checked,
            text: data.mainContent,
            tokens: lexer.inlineTokens(data.mainContent),
            nestedTokens,
          }),
          customNestedParser: (content) => parseTaskList(content, lexer),
        },
        lexer,
      );
      if (!parsed) return undefined;
      return { type: 'taskList', raw: parsed.raw, items: parsed.items };
    },
  },
});

export const BlockTaskItem = TaskItem.extend({
  content: 'block+',

  parseMarkdown: (token, helpers) => {
    const content: any[] = [];
    if (token.tokens?.length) {
      content.push(helpers.createNode('paragraph', {}, helpers.parseInline(token.tokens)));
    } else if (token.text) {
      content.push(
        helpers.createNode('paragraph', {}, [helpers.createNode('text', { text: token.text })]),
      );
    }

    if (token.nestedTokens?.length) content.push(...helpers.parseChildren(token.nestedTokens));
    if (content.length === 0) content.push(helpers.createNode('paragraph', {}, []));
    return helpers.createNode('taskItem', { checked: token.checked || false }, content);
  },

  renderMarkdown: (node, helpers) => {
    const prefix = `- [${node.attrs?.checked ? 'x' : ' '}] `;
    if (node.content?.[0]?.type === 'paragraph') {
      return renderNestedMarkdownContent(node, helpers, prefix);
    }

    return renderNestedMarkdownContent(
      { ...node, content: [{ type: 'paragraph' }, ...(node.content ?? [])] },
      helpers,
      prefix.trimEnd(),
    );
  },
}).configure({ nested: true });
