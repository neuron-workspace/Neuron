import { Sparkles } from 'lucide-react';
import type { PluginModule } from '../types';
import AssistantPanel from './AssistantPanel';

const aiOpenai: PluginModule = {
  manifest: {
    id: 'ai-openai',
    name: 'OpenAI Assistant',
    version: '1.0.0',
    author: 'Neuron',
    description: 'Chat with OpenAI GPT models about the note you are editing. Calls the OpenAI API through the desktop app.',
    category: 'ai',
    configSchema: [
      { key: 'apiKey', label: 'OpenAI API key', type: 'password', placeholder: 'sk-proj-…', description: 'Stored locally in app settings; used only for your requests.' },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'gpt-4o', description: 'Optional. Defaults to gpt-4o.' },
    ],
  },
  activate(host) {
    host.registerPanel({
      id: 'ai-openai.assistant',
      title: 'OpenAI',
      icon: Sparkles,
      render: (runtime) => (
        <AssistantPanel
          pluginId="ai-openai"
          host={runtime}
          provider="openai"
          defaultModel="gpt-4o"
          emptyHint="Ask OpenAI to summarize, rewrite, or expand the note you have open. Add your API key in plugin settings first."
        />
      ),
    });
  },
};

export default aiOpenai;
