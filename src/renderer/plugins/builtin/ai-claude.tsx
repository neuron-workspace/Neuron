import { Sparkles } from 'lucide-react';
import type { PluginModule } from '../types';
import AssistantPanel from './AssistantPanel';

const aiClaude: PluginModule = {
  manifest: {
    id: 'ai-claude',
    name: 'Claude Assistant',
    version: '1.0.0',
    author: 'Neuron',
    description: 'Chat with Anthropic Claude about the note you are editing. Calls the Claude API through the desktop app.',
    category: 'ai',
    connector: { id: 'anthropic', name: 'Claude', description: 'Anthropic Claude models, with your API key.' },
    configSchema: [
      { key: 'apiKey', label: 'Anthropic API key', type: 'password', placeholder: 'sk-ant-…', description: 'Stored in the main process. It is never readable by the app UI or by any plugin, including this one.' },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'claude-opus-4-8', description: 'Optional. Defaults to claude-opus-4-8.' },
    ],
  },
  activate(host) {
    host.registerPanel({
      id: 'ai-claude.assistant',
      title: 'Claude',
      icon: Sparkles,
      render: (runtime) => (
        <AssistantPanel
          host={runtime}
          provider="anthropic"
          defaultModel="claude-opus-4-8"
          emptyHint="Ask Claude to summarize, rewrite, or expand the note you have open. Set up Claude in Settings › Connectors first."
        />
      ),
    });
  },
};

export default aiClaude;
