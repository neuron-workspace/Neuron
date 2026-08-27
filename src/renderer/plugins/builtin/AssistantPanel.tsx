import React, { useRef, useState } from 'react';
import { CornerDownLeft, Loader2, Sparkles, ArrowDownToLine, FilePlus } from 'lucide-react';
import type { HostRuntime } from '../types';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';
import { cn } from '../../lib/utils';
import ReplyMarkdown from './ReplyMarkdown';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
  sources?: string[];
}

interface AssistantPanelProps {
  host: HostRuntime;
  /** Whose stored secret main should use. The key never reaches the renderer. */
  pluginId: string;
  provider: 'anthropic' | 'openai' | 'google' | 'local' | 'openrouter';
  defaultModel: string;
  emptyHint: string;
}

type ContextMode = 'none' | 'active' | 'workspace';

function getKeywordScore(content: string, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  let score = 0;
  if (words.length === 0) return 0;
  const contentLower = content.toLowerCase();
  for (const word of words) {
    const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escapedWord, 'g');
    const count = (contentLower.match(regex) || []).length;
    score += count;
  }
  return score;
}

export default function AssistantPanel({ host, pluginId, provider, defaultModel, emptyHint }: AssistantPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [contextMode, setContextMode] = useState<ContextMode>('active');
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages(history);
    setInput('');
    setBusy(true);

    let system = '';
    let sourcesUsed: string[] = [];

    if (contextMode === 'active' && host.activeNote) {
      system = `You are a writing assistant embedded in Neuron, a local Markdown notes app. The user is editing the note "${host.activeNote}". Its current content is below. Help with their request; keep answers concise and Markdown-friendly.\n\n---\n${host.noteContent}\n---`;
      sourcesUsed = [host.activeNote];
    } else if (contextMode === 'workspace') {
      // Find relevant notes by keyword scoring
      const scoredNotes = await Promise.all(
        host.notes.map(async (path) => {
          try {
            const content = await window.electronAPI.readNote(path);
            const score = getKeywordScore(content, text) + getKeywordScore(path, text) * 5; // Path matching gets a boost
            return { path, content, score };
          } catch {
            return { path, content: '', score: 0 };
          }
        })
      );

      // Take the top 3 matches with a score > 0
      const topMatches = scoredNotes
        .filter((n) => n.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (topMatches.length > 0) {
        system = `You are a writing assistant embedded in Neuron, a local Markdown notes app. Below are the most relevant files from the user's workspace containing answers to their query. Use their content to formulate your response. Help with their request; keep answers concise and Markdown-friendly.\n\n`;
        system += topMatches.map((m) => `--- File: "${m.path}" ---\n${m.content}\n---`).join('\n\n');
        sourcesUsed = topMatches.map((m) => m.path);
      } else {
        system = `You are a writing assistant embedded in Neuron, a local Markdown notes app. Keep answers concise and Markdown-friendly. The user asked about workspace notes but no matching keywords were found.`;
      }
    } else {
      system = 'You are a writing assistant embedded in Neuron, a local Markdown notes app. Keep answers concise and Markdown-friendly.';
    }

    const result = await host.ai.complete({
      provider,
      model: host.config.model || defaultModel,
      system,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      // host.config no longer carries the key -- main resolves it from its own
      // store using pluginId. baseUrl and model still travel; they are settings,
      // not secrets.
      pluginId,
      config: host.config,
    });

    setMessages((prev) => [
      ...prev,
      result.success
        ? { role: 'assistant', content: result.text ?? '', sources: sourcesUsed.length > 0 ? sourcesUsed : undefined }
        : { role: 'assistant', content: result.error ?? 'Request failed.', error: true },
    ]);
    setBusy(false);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  };

  const handleAppendToNote = async (content: string) => {
    if (!host.activeNote) return;
    try {
      const divider = host.noteContent ? '\n\n---\n\n' : '';
      const updatedContent = host.noteContent + divider + content;
      const result = await window.electronAPI.writeNote(host.activeNote, updatedContent);
      if (result.success) {
        await host.refreshNotes();
      }
    } catch (err) {
      console.error('Failed to append to note:', err);
    }
  };

  const handleCreateNewNote = async (content: string) => {
    try {
      let count = 1;
      let uniquePath = `assistant-response-${count}.mdx`;
      while (host.notes.includes(uniquePath)) {
        count++;
        uniquePath = `assistant-response-${count}.mdx`;
      }
      const title = `Assistant Response ${count}`;
      const noteBody = `# ${title}\n\n${content}\n`;
      const result = await host.createNote(uniquePath, noteBody);
      if (result) {
        host.openNote(uniquePath);
      }
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div ref={scrollRef} className="flex flex-col gap-3 p-3">
          {messages.length === 0 && (
            <div className="mt-6 px-2 text-center">
              <div className="mx-auto grid h-9 w-9 place-items-center rounded-md border border-[var(--divider)] bg-[var(--surface)] text-[var(--ink-muted)]">
                <Sparkles className="h-4 w-4" />
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--ink-muted)]">{emptyHint}</p>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                'rounded-md px-3 py-2 text-[13px] leading-6',
                message.role === 'user'
                  ? 'ml-6 bg-[var(--surface-hover)] text-[var(--ink)]'
                  : message.error
                    ? 'mr-6 border border-[color-mix(in_oklch,var(--danger)_44%,var(--divider))] bg-[var(--danger-surface)] text-[var(--danger)]'
                    : 'mr-6 border border-[var(--divider)] bg-[var(--surface)] text-[var(--ink-secondary)]',
              )}
            >
              {message.role === 'user' || message.error ? (
                <pre className="whitespace-pre-wrap break-words font-sans">{message.content}</pre>
              ) : (
                <ReplyMarkdown source={message.content} />
              )}

              {message.role === 'assistant' && !message.error && (
                <div className="mt-2.5 flex flex-col gap-2 border-t border-[var(--divider)] pt-2 shrink-0">
                  {message.sources && message.sources.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 text-[10px] text-[var(--ink-muted)] font-mono mb-1">
                      <span>Sources:</span>
                      {message.sources.map((src, i) => (
                        <span key={i} className="rounded bg-[var(--surface-hover)] px-1 border border-[var(--divider)]">
                          {src.split('/').pop() || src}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {host.activeNote && (
                      <button
                        onClick={() => void handleAppendToNote(message.content)}
                        className="text-[10px] text-[var(--accent-strong)] hover:text-[var(--ink)] flex items-center gap-1 font-medium transition-colors"
                        title={`Append response to "${host.activeNote}"`}
                      >
                        <ArrowDownToLine className="h-3 w-3" />
                        Append to note
                      </button>
                    )}
                    <button
                      onClick={() => void handleCreateNewNote(message.content)}
                      className="text-[10px] text-[var(--accent-strong)] hover:text-[var(--ink)] flex items-center gap-1 font-medium transition-colors"
                      title="Save response to a new note file"
                    >
                      <FilePlus className="h-3 w-3" />
                      Create note
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="mr-6 flex items-center gap-2 rounded-md border border-[var(--divider)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--ink-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-[var(--divider)] p-2.5 bg-[var(--canvas)] shrink-0">
        {/* Context Toggles */}
        <div className="mb-2 flex items-center justify-between px-1 text-[11px]">
          <span className="text-[var(--ink-muted)] font-medium">Context:</span>
          <div className="flex gap-1">
            <button
              onClick={() => setContextMode('none')}
              className={cn(
                'rounded px-1.5 py-0.5 border text-[10px] transition-all duration-150',
                contextMode === 'none'
                  ? 'border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--ink)] font-semibold'
                  : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]'
              )}
            >
              None
            </button>
            <button
              onClick={() => setContextMode('active')}
              disabled={!host.activeNote}
              className={cn(
                'rounded px-1.5 py-0.5 border text-[10px] transition-all duration-150',
                contextMode === 'active'
                  ? 'border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--ink)] font-semibold'
                  : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-40 disabled:cursor-not-allowed'
              )}
              title={!host.activeNote ? 'Open a note to use it as context' : undefined}
            >
              Active Note
            </button>
            <button
              onClick={() => setContextMode('workspace')}
              className={cn(
                'rounded px-1.5 py-0.5 border text-[10px] transition-all duration-150',
                contextMode === 'workspace'
                  ? 'border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--ink)] font-semibold'
                  : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]'
              )}
            >
              Search Workspace
            </button>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Ask assistant…"
            className="field max-h-32 min-h-[40px] resize-none px-2.5 py-2 text-[13px]"
          />
          <Button size="icon" onClick={() => void send()} disabled={busy || !input.trim()} aria-label="Send message">
            <CornerDownLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
